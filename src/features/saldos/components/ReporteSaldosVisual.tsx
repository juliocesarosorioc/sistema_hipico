"use client";

import React, { useState } from "react";
import { capturarNodo, guardarLienzos, type ImgFormato } from "@/features/impresion/lib/exportar";
import { redondearCentavos } from "@/shared/lib/dinero";

export type NivelAlertaSaldo = "LIBRE" | "HOLGADO" | "ALERTA" | "CRITICO" | "AGOTADO";

export type JugadorSaldoVisual = {
  id?: string | number;
  nombre: string;
  telefono?: string | null;
  saldoContable: number;
  aval: number;
  riesgoEnCurso: number;
  disponible: number;
  libre?: boolean;
  modoJuego?: string;
};

export type FiltroModalidadSaldo = "TODOS" | "AVAL" | "LIBRE" | "POZO";

export function obtenerModalidadJugadorVisual(c: JugadorSaldoVisual): "libre" | "pozo" | "aval" {
  if (c.modoJuego === "pozo") return "pozo";
  if (c.modoJuego === "libre" || c.libre) return "libre";
  return "aval";
}

export function infoModalidadJugadorVisual(tipo: "libre" | "pozo" | "aval") {
  switch (tipo) {
    case "libre":
      return { icono: "🔓", etiqueta: "Jugadores Libres", desc: "Saldo actual libre (+ / -)", badge: "bg-sky-100 text-sky-800 border-sky-300" };
    case "pozo":
      return { icono: "💰", etiqueta: "Jugadores con Pozo", desc: "Saldo actual positivo de pozo", badge: "bg-purple-100 text-purple-800 border-purple-300" };
    case "aval":
    default:
      return { icono: "🛡️", etiqueta: "Jugadores Avalados", desc: "Saldo actual (+ / -) / aval", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" };
  }
}

export type ReporteSaldosVisualProps = {
  grupo: string;
  logoGrupo?: string | null;
  hipodromo?: string;
  logoHipodromo?: string | null;
  carrera?: number | string;
  fecha?: string;
  clientes: JugadorSaldoVisual[];
};

export function clasificarAlertaSaldo(c: JugadorSaldoVisual): {
  nivel: NivelAlertaSaldo;
  icono: string;
  etiqueta: string;
  badgeCls: string;
  rowCls: string;
  barCls: string;
  porcentaje: number;
} {
  if (c.libre) {
    return {
      nivel: "LIBRE",
      icono: "🔵",
      etiqueta: "LIBRE",
      badgeCls: "bg-sky-100 text-sky-800 border-sky-300",
      rowCls: "bg-white border-slate-100",
      barCls: "bg-sky-500",
      porcentaje: 100,
    };
  }

  const disp = redondearCentavos(c.disponible);
  const capacidadBase = Math.max(
    redondearCentavos(Math.max(0, c.saldoContable) + Math.max(0, c.aval) + Math.max(0, c.riesgoEnCurso)),
    disp > 0 ? disp : 100
  );
  const ratio = capacidadBase > 0 ? Math.max(0, Math.min(100, Math.round((disp / capacidadBase) * 100))) : 0;

  if (disp <= 0) {
    return {
      nivel: "AGOTADO",
      icono: "🔴",
      etiqueta: "AGOTADO · S/S",
      badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
      rowCls: "bg-rose-50/70 border-rose-200",
      barCls: "bg-rose-600",
      porcentaje: 0,
    };
  }

  if (disp <= 50 || ratio <= 12) {
    return {
      nivel: "CRITICO",
      icono: "🟠",
      etiqueta: "CRÍTICO · POR AGOTAR",
      badgeCls: "bg-orange-100 text-orange-900 border-orange-300",
      rowCls: "bg-orange-50/60 border-orange-200",
      barCls: "bg-orange-500",
      porcentaje: Math.max(8, ratio),
    };
  }

  if (disp <= 200 || ratio <= 30) {
    return {
      nivel: "ALERTA",
      icono: "🟡",
      etiqueta: "CERCA DE AGOTAR",
      badgeCls: "bg-amber-100 text-amber-900 border-amber-300",
      rowCls: "bg-amber-50/50 border-amber-200",
      barCls: "bg-amber-500",
      porcentaje: Math.max(20, ratio),
    };
  }

  return {
    nivel: "HOLGADO",
    icono: "🟢",
    etiqueta: "SALDO ÓPTIMO",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    rowCls: "bg-white border-slate-100",
    barCls: "bg-emerald-500",
    porcentaje: Math.max(40, ratio),
  };
}

function fmtMonto(n: number): string {
  return redondearCentavos(n).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ReporteSaldosVisual({
  grupo,
  logoGrupo,
  hipodromo,
  logoHipodromo,
  carrera,
  fecha,
  clientes,
}: ReporteSaldosVisualProps) {
  const [exportando, setExportando] = useState(false);
  const [filtroModalidad, setFiltroModalidad] = useState<FiltroModalidadSaldo>("TODOS");

  const descargarImagen = async (formato: ImgFormato) => {
    const el = document.getElementById("reporte-saldos-imprimible");
    if (!el || exportando) return;
    setExportando(true);
    try {
      const canvas = await capturarNodo(el, 2);
      const base = `saldos-${(grupo || "grupo").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${fecha || "hoy"}`;
      await guardarLienzos([canvas], formato, base);
    } finally {
      setExportando(false);
    }
  };

  // Filtrado según requerimiento:
  // - AVAL: Saldo actual sea positivo o negativo / aval
  // - LIBRE: Saldo actual sea positivo o negativo libre
  // - POZO: Saldo actual positivo de pozo
  const clientesFiltrados = clientes.filter((c) => {
    const mod = obtenerModalidadJugadorVisual(c);
    if (filtroModalidad === "AVAL") return mod === "aval";
    if (filtroModalidad === "LIBRE") return mod === "libre";
    if (filtroModalidad === "POZO") {
      return mod === "pozo" && redondearCentavos(c.saldoContable) > 0.004;
    }
    return true;
  });

  // Ordenar: primero los que están en alerta/crítico/agotado o por orden alfabético dentro de su grupo
  const enriquecidos = clientesFiltrados
    .map((c) => ({ ...c, sem: clasificarAlertaSaldo(c) }))
    .sort((a, b) => {
      const ordenNivel: Record<NivelAlertaSaldo, number> = {
        CRITICO: 1,
        ALERTA: 2,
        AGOTADO: 3,
        HOLGADO: 4,
        LIBRE: 5,
      };
      const diff = ordenNivel[a.sem.nivel] - ordenNivel[b.sem.nivel];
      if (diff !== 0) return diff;
      return a.nombre.localeCompare(b.nombre, "es");
    });

  const mitad = Math.ceil(enriquecidos.length / 2);
  const col1 = enriquecidos.slice(0, mitad);
  const col2 = enriquecidos.slice(mitad);

  const conteo = {
    holgados: enriquecidos.filter((x) => x.sem.nivel === "HOLGADO" || x.sem.nivel === "LIBRE").length,
    alerta: enriquecidos.filter((x) => x.sem.nivel === "ALERTA").length,
    criticos: enriquecidos.filter((x) => x.sem.nivel === "CRITICO").length,
    agotados: enriquecidos.filter((x) => x.sem.nivel === "AGOTADO").length,
  };

  const renderColumna = (lista: typeof enriquecidos, offset: number) => (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="grid grid-cols-12 bg-slate-900 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-white">
        <div className="col-span-5">Jugador · Teléfono (Imagen)</div>
        <div className="col-span-4 text-center">Estado / Nivel</div>
        <div className="col-span-3 text-right">Disponible</div>
      </div>
      {lista.map((c, idx) => {
        const disp = redondearCentavos(c.disponible);
        const telLimpio = String(c.telefono ?? "").replace(/\D+/g, "");
        const modJugador = obtenerModalidadJugadorVisual(c);
        const infoMod = infoModalidadJugadorVisual(modJugador);
        return (
          <div
            key={`${c.id ?? c.nombre}-${idx}`}
            className={`grid grid-cols-12 items-center gap-1 px-2.5 py-1.5 text-[10px] ${c.sem.rowCls}`}
          >
            <div className="col-span-5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-200 text-[8px] font-black text-slate-700">
                  {offset + idx + 1}
                </span>
                <span
                  className="inline-flex shrink-0 text-[11px] cursor-help"
                  title={`${infoMod.etiqueta}: ${infoMod.desc}`}
                >
                  {infoMod.icono}
                </span>
                <span className="truncate font-black text-slate-900">{c.nombre}</span>
              </div>
              <div className="mt-0.5 pl-5 flex items-center gap-1 text-[9px] font-mono font-bold text-indigo-700">
                <span>📱</span>
                <span>{telLimpio ? `@${telLimpio}` : "Sin teléfono reg."}</span>
              </div>
            </div>

            <div className="col-span-4 flex flex-col items-center justify-center px-1">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${c.sem.badgeCls}`}
              >
                <span>{c.sem.icono}</span>
                <span>{c.sem.etiqueta}</span>
              </span>
              {!c.libre && (
                <div className="mt-1 h-1.5 w-full max-w-[90px] overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${c.sem.barCls}`}
                    style={{ width: `${c.sem.porcentaje}%` }}
                  />
                </div>
              )}
            </div>

            <div className="col-span-3 text-right font-mono">
              <div
                className={`text-[11px] font-black tabular-nums ${
                  c.libre
                    ? "text-sky-700"
                    : disp <= 0
                      ? "text-rose-700"
                      : c.sem.nivel === "CRITICO"
                        ? "text-orange-700"
                        : c.sem.nivel === "ALERTA"
                          ? "text-amber-700"
                          : "text-emerald-700"
                }`}
              >
                {c.libre ? "LIBRE" : disp > 0 ? `+${fmtMonto(disp)}` : fmtMonto(disp)}
              </div>
              {c.riesgoEnCurso > 0 && (
                <div className="text-[8px] font-semibold text-slate-500">
                  En juego: {fmtMonto(c.riesgoEnCurso)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Barra de controles: filtros por modalidad y botones de exportación */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-indigo-950 mr-1">Filtro Modalidad:</span>
          <button
            type="button"
            onClick={() => setFiltroModalidad("TODOS")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              filtroModalidad === "TODOS"
                ? "bg-indigo-700 text-white shadow-sm ring-2 ring-indigo-300"
                : "bg-white text-indigo-900 border border-indigo-200 hover:bg-indigo-100"
            }`}
          >
            🌐 Todos ({clientes.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroModalidad("AVAL")}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              filtroModalidad === "AVAL"
                ? "bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-300"
                : "bg-white text-emerald-900 border border-emerald-300 hover:bg-emerald-50"
            }`}
            title="Muestra el saldo actual sea positivo o negativo / aval asignado"
          >
            <span>🛡️</span>
            <span>Jugadores Avalados ({clientes.filter((c) => obtenerModalidadJugadorVisual(c) === "aval").length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFiltroModalidad("LIBRE")}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              filtroModalidad === "LIBRE"
                ? "bg-sky-700 text-white shadow-sm ring-2 ring-sky-300"
                : "bg-white text-sky-900 border border-sky-300 hover:bg-sky-50"
            }`}
            title="Muestra el saldo actual sea positivo o negativo libre"
          >
            <span>🔓</span>
            <span>Jugadores Libres ({clientes.filter((c) => obtenerModalidadJugadorVisual(c) === "libre").length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFiltroModalidad("POZO")}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              filtroModalidad === "POZO"
                ? "bg-purple-700 text-white shadow-sm ring-2 ring-purple-300"
                : "bg-white text-purple-900 border border-purple-300 hover:bg-purple-50"
            }`}
            title="Muestra el saldo actual positivo de pozo"
          >
            <span>💰</span>
            <span>Jugadores con Pozo ({clientes.filter((c) => obtenerModalidadJugadorVisual(c) === "pozo" && redondearCentavos(c.saldoContable) > 0.004).length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exportando}
            onClick={() => void descargarImagen("PNG")}
            className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-600 disabled:opacity-50"
          >
            {exportando ? "Generando…" : "📸 Descargar Imagen PNG"}
          </button>
          <button
            type="button"
            disabled={exportando}
            onClick={() => void descargarImagen("JPG")}
            className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            📸 JPG
          </button>
        </div>
      </div>

      {/* Lienzo imprimible con la misma línea gráfica de ReporteCarrera */}
      <div
        id="reporte-saldos-imprimible"
        className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white font-sans text-[11px] leading-tight shadow-lg"
      >
        {/* 1. ENCABEZADO AZUL CORPORATIVO */}
        <div className="flex items-center gap-3 border-b border-blue-500/30 bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600 px-4 py-3 text-white shadow-md">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-transparent">
            {logoHipodromo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoHipodromo}
                alt={hipodromo || "Hipódromo"}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-3xl leading-none">💰</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-[9px] font-bold uppercase tracking-widest text-blue-200">
              Reporte Visual de Disponibilidad y Alerta de Saldos
            </h3>
            <h2 className="truncate text-lg font-extrabold tracking-tight text-white">
              {grupo || "Club del Dinero"}
            </h2>
            <p className="mt-0.5 text-[10px] font-medium text-blue-100">
              {hipodromo ? `${hipodromo}` : "Jornada Activa"}
              {carrera ? ` · Carrera ${carrera}` : ""}
              {fecha ? ` · ${fecha}` : ""}
              {filtroModalidad !== "TODOS" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">
                  {filtroModalidad === "AVAL" && "🛡️ Jugadores Avalados (+/-)"}
                  {filtroModalidad === "LIBRE" && "🔓 Jugadores Libres (+/-)"}
                  {filtroModalidad === "POZO" && "💰 Jugadores con Pozo (> 0)"}
                </span>
              )}
            </p>
          </div>

          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 p-1">
            {logoGrupo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoGrupo}
                alt={grupo}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-2xl leading-none">🏇</span>
            )}
          </div>
        </div>

        {/* 2. SIMBOLOGÍA Y SEMÁFORO DE SALDOS */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[9.5px] font-black">
            <span className="uppercase tracking-wider text-slate-500">Simbología de Saldo:</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-emerald-900">
              🟢 Óptimo ({conteo.holgados})
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-amber-900">
              🟡 Cerca de agotar ≤30% ({conteo.alerta})
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-2.5 py-0.5 text-orange-900">
              🟠 Crítico ≤12% ({conteo.criticos})
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-rose-900">
              🔴 Agotado / S/S ({conteo.agotados})
            </span>
          </div>
          <span className="text-[9px] font-bold text-slate-500">
            📱 Identificación @teléfono incluida solo en imagen
          </span>
        </div>

        {/* 3. LISTADO EN 2 COLUMNAS */}
        <div className="grid grid-cols-1 gap-4 bg-slate-50/60 p-4 md:grid-cols-2">
          {renderColumna(col1, 0)}
          {col2.length > 0 ? renderColumna(col2, col1.length) : null}
        </div>

        {/* 3.1 LEYENDA DETALLADA DE MODALIDADES DE JUGADORES */}
        <div className="border-t border-slate-200 bg-slate-100/70 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-1">
            <span>📌</span>
            <span>Leyenda de Modalidades de Jugadores</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[9.5px]">
            <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-white p-2.5 text-sky-950 shadow-sm">
              <span className="text-xl leading-none">🔓</span>
              <div>
                <strong className="font-extrabold text-sky-900 block text-[10px]">Jugadores Libres</strong>
                <span className="text-slate-600">Muestra el saldo actual sea positivo o negativo libre (sin cupo asignado).</span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-white p-2.5 text-emerald-950 shadow-sm">
              <span className="text-xl leading-none">🛡️</span>
              <div>
                <strong className="font-extrabold text-emerald-900 block text-[10px]">Jugadores Avalados</strong>
                <span className="text-slate-600">Muestra el saldo actual sea positivo o negativo / aval asignado.</span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-purple-200 bg-white p-2.5 text-purple-950 shadow-sm">
              <span className="text-xl leading-none">💰</span>
              <div>
                <strong className="font-extrabold text-purple-900 block text-[10px]">Jugadores con Pozo</strong>
                <span className="text-slate-600">Muestra el saldo actual positivo de pozo acumulado a favor.</span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. PIE DE PÁGINA DE DERECHOS DE AUTOR */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-900 px-4 py-2 text-[9px] text-slate-300">
          <span>
            © {new Date().getFullYear()} <strong className="font-black text-amber-400">Inversiones Club Sensación, C.A.</strong> — Todos los derechos reservados · Propiedad Intelectual Protegida
          </span>
          <span>Total jugadores mostrados: {enriquecidos.length} · Recargas y avales por administración</span>
        </div>
      </div>
    </div>
  );
}

export type ModalReporteSaldosVisualProps = ReporteSaldosVisualProps & {
  abierto: boolean;
  onCerrar: () => void;
};

/**
 * Modal flotante del Reporte Visual de Disponibilidad y Alerta de Saldos.
 */
export function ModalReporteSaldosVisual({
  abierto,
  onCerrar,
  ...propsReporte
}: ModalReporteSaldosVisualProps) {
  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-950 via-blue-900 to-indigo-800 px-4 py-3 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 border border-amber-300/40 text-lg">
              📊
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black uppercase tracking-wider text-amber-300">
                Reporte Visual de Disponibilidad y Alerta de Saldos
              </h2>
              <p className="truncate text-[11px] font-medium text-indigo-200">
                {propsReporte.grupo || "Grupo Activo"}
                {propsReporte.hipodromo ? ` · ${propsReporte.hipodromo}` : ""}
                {propsReporte.carrera ? ` · Carrera ${propsReporte.carrera}` : ""}
                {propsReporte.fecha ? ` · ${propsReporte.fecha}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-sm font-black text-white transition hover:bg-rose-600 hover:border-rose-500"
            title="Cerrar modal (Esc)"
            aria-label="Cerrar Reporte Visual de Disponibilidad y Alerta de Saldos"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-100/80">
          <ReporteSaldosVisual {...propsReporte} />
        </div>
      </div>
    </div>
  );
}

export type BotonIconoReporteSaldosVisualProps = ReporteSaldosVisualProps & {
  etiqueta?: string;
  soloIcono?: boolean;
  className?: string;
};

/**
 * Botón con ícono que activa el Modal del Reporte Visual de Disponibilidad y Alerta de Saldos.
 */
export function BotonIconoReporteSaldosVisual({
  etiqueta = "Reporte Visual de Disponibilidad y Alerta de Saldos",
  soloIcono = false,
  className,
  ...propsReporte
}: BotonIconoReporteSaldosVisualProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Abrir Reporte Visual de Disponibilidad y Alerta de Saldos"
        aria-label="Abrir Reporte Visual de Disponibilidad y Alerta de Saldos"
        className={
          className ||
          (soloIcono
            ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-50 text-base text-indigo-900 shadow-sm transition hover:bg-indigo-100"
            : "inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] font-black text-indigo-900 shadow-sm transition hover:bg-indigo-100")
        }
      >
        <span className="text-sm leading-none">📊</span>
        {!soloIcono && <span>{etiqueta}</span>}
      </button>
      <ModalReporteSaldosVisual
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        {...propsReporte}
      />
    </>
  );
}

export default ReporteSaldosVisual;
