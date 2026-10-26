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
};

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

  // Ordenar: primero los que están en alerta/crítico/agotado o por orden alfabético dentro de su grupo
  const enriquecidos = clientes
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
        return (
          <div
            key={`${c.id ?? c.nombre}-${idx}`}
            className={`grid grid-cols-12 items-center gap-1 px-2.5 py-1.5 text-[10px] ${c.sem.rowCls}`}
          >
            <div className="col-span-5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-200 text-[8px] font-black text-slate-700">
                  {offset + idx + 1}
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
      {/* Barra de exportación de imagen */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2">
        <div className="text-xs font-bold text-indigo-950">
          🖼️ Vista Gráfica de Saldos (el número de teléfono <code className="font-mono">@número</code> se visualiza únicamente en esta imagen)
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

        {/* 4. PIE DE PÁGINA DE DERECHOS DE AUTOR */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-900 px-4 py-2 text-[9px] text-slate-300">
          <span>
            © {new Date().getFullYear()} <strong className="font-black text-amber-400">Inversiones Club Sensación, C.A.</strong> — Todos los derechos reservados · Propiedad Intelectual Protegida
          </span>
          <span>Total jugadores: {enriquecidos.length} · Recargas y avales por administración</span>
        </div>
      </div>
    </div>
  );
}

export default ReporteSaldosVisual;
