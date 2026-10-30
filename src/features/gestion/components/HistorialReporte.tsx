"use client";
import { DateInput } from "@/shared/components/ui/DateInput";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getHorseColor } from "@/shared/lib/horseColors";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { cargarCarrerasDelDia } from "@/features/carreras/lib/carreras-dia";
import {
  reportesCarrerasLote,
  type CarreraReporte,
  type FilaReporte,
} from "@/features/liquidacion/lib/reportes";
import {
  listarDepositos,
  listarTransacciones,
  type DepositoRow,
  type TransaccionRow,
} from "@/features/contabilidad/lib/contabilidad";
import ReporteLiquidacionModal from "@/features/gestion/components/ReporteLiquidacionModal";
import { listarMonitorJugadas, type FilaMonitorJugada } from "@/features/jugadas/lib/jugadas";
import { etiquetaJugada, caballoPareoLegible } from "@/features/taquilla/lib/nomenclatura";

// Color de los cuadritos de los caballos: DELEGA en la fuente única
// (`shared/lib/horseColors`, gualdrapas oficiales) en vez de repetir la paleta.
// El único fondo que necesita borde propio es el blanco (si no se pierde).
const getColorCaballo = (num: string) => {
  const c = getHorseColor(num);
  return { bg: c.hex, fg: c.hexText, border: c.bg === "bg-white" ? "1px solid #cbd5e1" : "none" };
};

/** Fila ya normalizada para la tabla del historial. */
type Movimiento = {
  hora: string;
  tipo: string;
  cliente: string;
  sub: string;
  monto: number;
  /** "dep" | "transf" | "retiro" — pinta la píldora de color. */
  clase: "dep" | "transf" | "retiro";
};

/** Carrera de la fecha consultada con su reporte de liquidación. */
type CarreraHistorial = {
  hipodromo: string;
  carrera: number;
  /** Pizarra oficial (1º, 2º, 3º…). */
  pizarra: string[];
  /** Detalle de jugadas; null cuando la carrera no tiene tickets. */
  detalle: CarreraReporte | null;
};

const ETIQUETA_DEPOSITO: Record<string, string> = {
  Normal: "DEPÓSITO",
  "Otorgar Aval": "DEP AVAL",
  "Pagar Aval": "PAGA AVAL",
};

function horaDe(iso: string | null): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(11, 19) || "--:--:--";
  return d.toLocaleTimeString("es-VE", { hour12: false });
}

/** Ítem 11: clave normalizada del hipódromo para agrupar/filtrar. */
const normHip = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

function dinero(n: number, conSigno = false): string {
  const s = n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return conSigno && n > 0 ? `+${s}` : s;
}

/** Depósitos del día + transferencias/retiros, ya filtrados por fecha. */
function aMovimientos(depositos: DepositoRow[], transacciones: TransaccionRow[], fecha: string): Movimiento[] {
  const out: Movimiento[] = [];

  for (const d of depositos) {
    const f = String(d.fecha ?? "").slice(0, 10);
    if (fecha && f && f !== fecha) continue;
    out.push({
      hora: horaDe(d.fecha),
      tipo: ETIQUETA_DEPOSITO[d.tipo_operacion ?? ""] ?? String(d.tipo_operacion ?? "DEPÓSITO").toUpperCase(),
      cliente: String(d.cliente_nombre ?? "—").toUpperCase(),
      sub: d.modalidad || d.banco_nombre || d.nota || "",
      monto: Number(d.monto_usd ?? d.monto ?? 0),
      clase: "dep",
    });
  }

  for (const t of transacciones) {
    const f = String(t.fecha ?? "").slice(0, 10);
    if (fecha && f && f !== fecha) continue;
    const op = String(t.tipo_operacion ?? "").toUpperCase();
    out.push({
      hora: horaDe(t.fecha),
      tipo: op === "RETIRO" ? "RETIRO" : "TRANSFERENCIA",
      cliente: String(t.cliente_origen_nombre ?? "—").toUpperCase(),
      sub: t.modalidad || t.banco_nombre || t.nota || (t.cliente_destino_nombre ? `→ ${t.cliente_destino_nombre}` : ""),
      monto: Number(t.monto_usd ?? t.monto ?? 0),
      clase: op === "RETIRO" ? "retiro" : "transf",
    });
  }

  out.sort((a, b) => b.hora.localeCompare(a.hora));
  return out;
}

/** Una línea de jugada en formato de recibo: `2Y2N 5 40 VALVERDE`. */
function lineaDe(f: FilaReporte): string {
  const partes = [etiquetaJugada(f.jugada), caballoPareoLegible(f.caballo)];
  if (f.rol !== "CRUCE" && f.monto > 0) partes.push(String(Math.round(f.monto)));
  const cliente = f.rol === "Consigue" ? `DA ${f.cliente}` : f.cliente;
  return partes.filter(Boolean).join(" ") + (cliente ? ` ${cliente}` : "");
}

/** Balance neto por cliente en la carrera (ganancia/ pérdida del jugador). */
function balancesDe(filas: FilaReporte[]): Array<{ nombre: string; monto: number }> {
  const mapa = new Map<string, number>();
  for (const f of filas) {
    if (f.resultado == null) continue;
    mapa.set(f.cliente, (mapa.get(f.cliente) ?? 0) + f.resultado);
  }
  return [...mapa.entries()]
    .map(([nombre, monto]) => ({ nombre, monto: Math.round(monto * 100) / 100 }))
    .sort((a, b) => b.monto - a.monto);
}

const COLOR_CLASE: Record<Movimiento["clase"], string> = {
  dep: "bg-[#3b82f6]",
  transf: "bg-orange-500",
  retiro: "bg-red-600",
};

export default function HistorialReporte() {
  const [fecha, setFecha] = useState<string>(() => hoyLocal());
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [carreras, setCarreras] = useState<CarreraHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<string>("");
  // Ítem 11: filtro por hipódromo y selección de carrera → reporte de liquidación.
  const [hipodromoFiltro, setHipodromoFiltro] = useState<string>("");
  const [reporte, setReporte] = useState<{ hipodromo: string; carrera: number } | null>(null);
  // Ítem 4: inbox de PENDIENTES (carreras con jugadas y SIN resultado cargado).
  const [pendientes, setPendientes] = useState<FilaMonitorJugada[]>([]);

  const cargar = useCallback(async (f: string) => {
    setCargando(true);
    setError(null);
    try {
      // 1) Movimientos del día (depósitos + transferencias/retiros).
      const [depositos, transacciones] = await Promise.all([
        listarDepositos(200),
        listarTransacciones(200),
      ]);
      setMovimientos(aMovimientos(depositos, transacciones, f));

      // 2) Carreras de la fecha con resultado cargado + su liquidación.
      const delDia = await cargarCarrerasDelDia(f);
      const conResultado = delDia
        .filter((c) => c.fecha === f && ((c.ganadores && c.ganadores.length > 0) || c.estado !== "Programada"))
        .slice(0, 40);

      // Un solo lote de consultas para todas las carreras (agrupado por
      // hipódromo) en vez de 3 consultas por carrera.
      const reps = await reportesCarrerasLote(
        conResultado.map((c) => ({ fecha: c.fecha, hipodromo: c.hipodromo, carrera: c.carrera }))
      );
      const detalle = conResultado.map((c, i) => {
        const rep = reps[i] ?? null;
        const pizarra =
          c.ganadores && c.ganadores.length
            ? c.ganadores
            : rep?.pizarra
              ? rep.pizarra.split(/[·|]/).map((s) => s.trim()).filter(Boolean)
              : [];
        return { hipodromo: c.hipodromo, carrera: Number(c.carrera), pizarra, detalle: rep } as CarreraHistorial;
      });
      detalle.sort((a, b) => {
        const cmpH = a.hipodromo.localeCompare(b.hipodromo, "es");
        if (cmpH !== 0) return cmpH;
        return Number(a.carrera) - Number(b.carrera);
      });
      setCarreras(detalle.filter((c) => c.detalle !== null && c.detalle.filas.some((f) => f.rol !== "CRUCE")));
      // Ítem 4: PENDIENTES de la jornada = carreras con jugadas y sin resultado.
      // Fuente única: la misma vista del Monitor de Jugadas (v_jugadas_monitor).
      try {
        const mon = await listarMonitorJugadas();
        setPendientes(
          mon.filas
            .filter(
              (fila) => fila.fecha_carrera === f && fila.total_jugadas > 0 && !fila.resultado_cargado
            )
            .sort((a, b) => {
              const cmpH = a.hipodromo.localeCompare(b.hipodromo, "es");
              if (cmpH !== 0) return cmpH;
              return Number(a.carrera) - Number(b.carrera);
            })
        );
      } catch {
        setPendientes([]);
      }
      setActualizado(new Date().toLocaleTimeString("es-VE", { hour12: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(fecha);
  }, [fecha, cargar]);

  const totales = React.useMemo(() => {
    const dep = movimientos.filter((m) => m.clase === "dep").reduce((a, m) => a + m.monto, 0);
    const ret = movimientos.filter((m) => m.clase === "retiro").reduce((a, m) => a + m.monto, 0);
    const trf = movimientos.filter((m) => m.clase === "transf").reduce((a, m) => a + m.monto, 0);
    return {
      depositos: movimientos.filter((m) => m.clase === "dep").length,
      depositado: dep,
      retiros: movimientos.filter((m) => m.clase === "retiro").length,
      retirado: ret,
      transferencias: movimientos.filter((m) => m.clase === "transf").length,
      transferido: trf,
      neto: dep - ret,
    };
  }, [movimientos]);

  // Ítem 11: hipódromos presentes en la jornada y lista filtrada por hipódromo.
  const hipodromos = useMemo(() => {
    const set = new Set<string>();
    for (const c of carreras) if (c.hipodromo) set.add(normHip(c.hipodromo));
    for (const p of pendientes) if (p.hipodromo) set.add(normHip(p.hipodromo));
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [carreras, pendientes]);

  const carrerasVisibles = useMemo(
    () => (hipodromoFiltro ? carreras.filter((c) => normHip(c.hipodromo) === hipodromoFiltro) : carreras),
    [carreras, hipodromoFiltro]
  );

  // Ítem 4: pendientes filtradas por el mismo hipódromo elegido.
  const pendientesVisibles = useMemo(
    () => (hipodromoFiltro ? pendientes.filter((p) => normHip(p.hipodromo) === hipodromoFiltro) : pendientes),
    [pendientes, hipodromoFiltro]
  );

  return (
    <div className="min-h-screen bg-[#eef2f7] font-sans text-slate-800">

      {/* Cabecera Principal */}
      <header className="bg-[#1f2937] text-white px-4 py-3 flex items-center justify-between gap-2 shadow-md">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
          <span className="text-lg">🇦🇷</span>
          <h1 className="text-[15px] font-bold tracking-wide">Historial</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-300">
            Fecha
            <DateInput
              value={fecha}
              onFechaChange={(val) => setFecha(val || hoyLocal())}
              className="w-32 py-1 px-2 text-[11px] font-bold bg-gray-800 text-white border-gray-600"
            />
          </label>
          <button
            type="button"
            onClick={() => setFecha(hoyLocal())}
            className="rounded border border-gray-600 px-2 py-1 text-[11px] font-bold text-gray-200 hover:bg-gray-700"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => void cargar(fecha)}
            disabled={cargando}
            className="rounded border border-gray-600 px-2 py-1 text-[11px] font-bold text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {cargando ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {/* Barra de Resumen Financiero */}
      <div className="bg-white border-b border-gray-300 px-4 py-2 flex flex-wrap gap-6 text-[11px] font-bold shadow-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-green-600 rounded-full"></div>
          <span className="text-gray-500">Depósitos:</span>
          <span className="text-green-600">{totales.depositos} (+${dinero(totales.depositado)})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
          <span className="text-gray-500">Retiros:</span>
          <span className="text-red-600">{totales.retiros} (-${dinero(totales.retirado)})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
          <span className="text-gray-500">Transferencias:</span>
          <span className="text-orange-600">{totales.transferencias} (${dinero(totales.transferido)})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Neto del día:</span>
          <span className="text-green-600">+${dinero(totales.neto)}</span>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
          No se pudo cargar el historial: {error}
        </div>
      )}

      {/* Contenedor Principal (Grid de 2 columnas) */}
      <div className="p-4 flex flex-col lg:flex-row gap-4 max-w-[1600px] mx-auto">

        {/* Columna Izquierda: Historial de Transacciones (30%) */}
        <div className="lg:w-[32%] flex flex-col gap-4">
          <div className="bg-white shadow-sm border border-gray-200 rounded-sm overflow-hidden">
            {/* Cabecera de la tabla de transacciones */}
            <div className="bg-[#1f2937] text-gray-300 text-[10px] font-bold flex px-3 py-2 uppercase">
              <div className="w-[20%]">Hora</div>
              <div className="w-[25%]">Tipo</div>
              <div className="w-[30%]">Cliente</div>
              <div className="w-[25%] text-right">Monto USD</div>
            </div>

            {/* Lista de transacciones */}
            <div className="flex flex-col">
              {cargando && (
                <div className="px-3 py-6 text-center text-[11px] font-bold text-gray-400">
                  Cargando movimientos…
                </div>
              )}
              {!cargando && movimientos.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px] font-bold text-gray-400">
                  Sin movimientos registrados en esta fecha
                </div>
              )}
              {movimientos.map((t, idx) => (
                <div key={idx} className="flex items-center px-3 py-3 border-b border-gray-100 text-[11px] hover:bg-gray-50">
                  <div className="w-[20%] text-gray-500 font-mono">{t.hora}</div>
                  <div className="w-[25%]">
                    <span className={`${COLOR_CLASE[t.clase]} text-white px-2 py-0.5 rounded-[3px] font-bold text-[9px]`}>{t.tipo}</span>
                  </div>
                  <div className="w-[30%] flex flex-col leading-tight">
                    <span className="font-bold text-green-700 uppercase">{t.cliente}</span>
                    {t.sub && <span className="text-[9px] text-gray-400 italic">· {t.sub}</span>}
                  </div>
                  <div className="w-[25%] text-right font-bold text-green-600 text-[12px]">
                    ${dinero(t.monto)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cuadro Resumen de Totales del Día */}
          <div className="bg-white shadow-sm border border-gray-200 rounded-sm p-4 text-[12px] font-bold">
            <div className="flex justify-between mb-3">
              <span className="text-gray-500 uppercase text-[10px]">Depósitos <span className="text-green-600 text-[12px] ml-1">+${dinero(totales.depositado)}</span></span>
              <span className="text-gray-500 uppercase text-[10px]">Retiros <span className="text-red-600 text-[12px] ml-1">-${dinero(totales.retirado)}</span></span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 uppercase text-[10px]">Transferencias <span className="text-orange-600 text-[12px] ml-1">${dinero(totales.transferido)}</span></span>
              <span className="text-gray-500 uppercase text-[10px]">Neto del Día <span className="text-green-600 text-[12px] ml-1">+${dinero(totales.neto)}</span></span>
            </div>
            <div className="text-center text-[9px] text-gray-400 font-normal mt-4 pt-2 border-t border-gray-100">
              {movimientos.length} transacciones
              {actualizado && <> · actualizado {actualizado}</>}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Carreras de la fecha (70%) */}
        <div className="lg:w-[68%] flex flex-col gap-4">

          {/* ÍTEM 4 — Inbox: TODO lo pendiente de la jornada (con jugadas, sin resultado) */}
          {!cargando && pendientesVisibles.length > 0 && (
            <div className="rounded-sm border border-amber-300 bg-amber-50 overflow-hidden">
              <div className="bg-amber-500 text-white text-[11px] font-bold px-4 py-2 flex items-center justify-between tracking-widest uppercase">
                <span className="flex items-center gap-2"><span className="text-[14px]">⏳</span> Pendientes de resultado · {fecha}</span>
                <span className="text-[10px]">{pendientesVisibles.length} carrera(s) con jugadas</span>
              </div>
              <div className="divide-y divide-amber-100">
                {pendientesVisibles.map((p) => (
                  <div key={`${p.hipodromo}-${p.carrera}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-900">{nombreHipodromoParaMostrar(p.hipodromo)} — {p.carrera}ª Carrera</span>
                      <span className="text-amber-700">{p.total_jugadas} jugada(s)</span>
                      <span className="text-amber-700">· en juego {p.en_juego}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReporte({ hipodromo: normHip(p.hipodromo), carrera: p.carrera })}
                      className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-700"
                      title="Abrir el Reporte de Liquidación (cargar resultado / liquidar)"
                    >
                      🧾 Reporte
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#1f2937] text-gray-300 text-[11px] font-bold px-4 py-2 flex items-center justify-between gap-2 rounded-sm shadow-sm tracking-widest uppercase">
            <span className="flex items-center gap-2"><span className="opacity-70 text-[14px]">▦</span> Resultados cargados · {fecha}</span>
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <label className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase">
                Hipódromo
                <select
                  value={hipodromoFiltro}
                  onChange={(e) => setHipodromoFiltro(e.target.value)}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-[10px] font-bold text-white"
                >
                  <option value="">Todos</option>
                  {hipodromos.map((h) => (
                    <option key={h} value={h}>{nombreHipodromoParaMostrar(h)}</option>
                  ))}
                </select>
              </label>
              <span className="text-[10px] font-bold text-gray-400">{carrerasVisibles.length} encontrada(s)</span>
            </span>
          </div>

          {cargando && (
            <div className="rounded-sm border border-gray-200 bg-white px-3 py-6 text-center text-[11px] font-bold text-gray-400">
              Cargando carreras…
            </div>
          )}

          {!cargando && carrerasVisibles.length === 0 && (
            <div className="rounded-sm border border-gray-200 bg-white px-3 py-6 text-center text-[11px] font-bold text-gray-400">
              {carreras.length === 0
                ? "No hay carreras con resultado cargado en esta fecha"
                : "No hay carreras con resultado para el hipódromo elegido"}
            </div>
          )}

          {/* Tarjetas de Carreras */}
          <div className="flex flex-col gap-4">
            {carrerasVisibles.map((c, i) => {
              const balances = balancesDe(c.detalle?.filas ?? []);
              const lineas = (c.detalle?.filas ?? []).length;
              const jugadas = (c.detalle?.filas ?? []).filter((f) => f.rol !== "CRUCE");
              const cruces = (c.detalle?.filas ?? []).filter((f) => f.rol === "CRUCE");
              return (
              <div key={`${c.hipodromo}-${c.carrera}-${i}`} className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">

                {/* Cabecera Azul de la Carrera */}
                <div className="bg-[#2563eb] text-white px-3 py-2 flex justify-between items-center">
                  <div className="text-[12px] font-bold flex items-center gap-2">
                    <span>🏇</span> {nombreHipodromoParaMostrar(c.hipodromo)} — {c.carrera}ª Carrera
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold">{c.detalle?.fecha ?? fecha}</span>
                    <button
                      type="button"
                      onClick={() => setReporte({ hipodromo: normHip(c.hipodromo), carrera: c.carrera })}
                      className="rounded bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-black/40"
                      title="Abrir el Reporte de Liquidación de esta carrera"
                    >
                      🧾 Reporte
                    </button>
                  </div>
                </div>

                {/* Sub-cabecera con los cuadros de llegada */}
                <div className="bg-white border-b border-gray-200 px-3 py-1.5 flex items-center gap-2 text-[11px]">
                  {c.pizarra.length > 0 ? (
                    <div className="flex gap-0.5">
                      {c.pizarra.map((res, j) => {
                        const col = getColorCaballo(res);
                        return (
                          <div key={j} className="flex items-center">
                            <span
                              className="w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold shadow-sm"
                              style={{ backgroundColor: col.bg, color: col.fg, border: col.border || 'none' }}
                            >
                              {res}
                            </span>
                            {j < c.pizarra.length - 1 && <span className="text-gray-400 mx-0.5 font-bold">.</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-gray-400 italic">Sin pizarra cargada</span>
                  )}
                  <span className="text-gray-400 font-medium ml-2">{lineas} líneas</span>
                </div>

                {/* Contenido (Jugadas a la izquierda, Resultados a la derecha) */}
                <div className="flex flex-col md:flex-row">

                  {/* Panel Jugadas */}
                  <div className="md:w-[75%] p-3 border-r border-gray-100">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] font-bold text-gray-400 tracking-wider">JUGADAS</span>
                    </div>
                    <div className="font-mono text-[11px] text-gray-600 leading-[1.6] whitespace-pre-wrap">
                      {jugadas.length === 0 && cruces.length === 0 && (
                        <div className="text-gray-400 italic">Sin jugadas registradas</div>
                      )}
                      {jugadas.map((f) => (
                        <div key={f.id}>{lineaDe(f)}</div>
                      ))}
                      {cruces.map((f) => (
                        <div key={f.id} className="text-gray-500">🔀 CRUCE {f.cliente} ${dinero(f.resultado ?? 0, true)}</div>
                      ))}
                    </div>
                  </div>

                  {/* Panel Resultados (Balances) */}
                  <div className="md:w-[25%] p-3 bg-gray-50/30">
                    <div className="text-[10px] font-bold text-gray-400 tracking-wider mb-3">RESULTADOS</div>
                    <div className="flex flex-col gap-2">
                      {balances.length === 0 && (
                        <div className="text-[10px] text-gray-400 italic">Sin liquidación</div>
                      )}
                      {balances.map((bal, idx) => (
                        <div key={idx} className="flex justify-between items-center text-[10px] font-bold uppercase">
                          <span className="text-gray-500">{bal.nombre}</span>
                          <span className={`${bal.monto >= 0 ? "text-green-600" : "text-red-600"} text-[11px] font-black`}>
                            ${dinero(bal.monto, true)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Ítem 11: al elegir una carrera se abre su Reporte de Liquidación. */}
      <ReporteLiquidacionModal
        abierto={!!reporte}
        onCerrar={() => setReporte(null)}
        hipodromoInicial={reporte?.hipodromo}
        carreraInicial={reporte?.carrera}
        fechaInicial={fecha}
      />
    </div>
  );
}
