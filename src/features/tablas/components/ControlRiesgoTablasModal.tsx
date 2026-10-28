"use client";

import { useEffect, useState, useMemo } from "react";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { colorDeNumero, textoDeNumero, parseNum } from "@/features/tablas/lib/tipos";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { Flag } from "@/shared/components/ui/BanderaPais";
import { HorseBadge } from "@/shared/components/ui/HorseChips";
import { Button } from "@/shared/components/ui/Button";
import { formatoMoneda } from "@/shared/lib/vzla";
import { guardarCuposTabla, type CupoTablaGrupo } from "@/features/grupos/lib/grupos";
import {
  obtenerAnalisisRiesgoTabla,
  guardarMaximoPorEjemplar,
  autorizarMasTablasEjemplar,
  type AnalisisRiesgoCarrera,
  type AnalisisCaballoRiesgo,
  type CompradorEjemplar,
} from "@/features/tablas/lib/control-riesgo";

type Props = {
  abierto: boolean;
  tabla: TablaFijaRow | null;
  onCerrar: () => void;
  onActualizado?: (caballos?: any[]) => void;
};

export function ControlRiesgoTablasModal({
  abierto,
  tabla,
  onCerrar,
  onActualizado,
}: Props) {
  const [tabActiva, setTabActiva] = useState<"ejemplares" | "grupos" | "compradores">("ejemplares");
  const [analisis, setAnalisis] = useState<AnalisisRiesgoCarrera | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Edición de cupos por grupo
  const [cuposGruposEdit, setCuposGruposEdit] = useState<CupoTablaGrupo[]>([]);
  const [guardandoGrupos, setGuardandoGrupos] = useState(false);

  // Submodal para ver compradores de un caballo específico
  const [caballoCompradores, setCaballoCompradores] = useState<AnalisisCaballoRiesgo | null>(null);

  // Submodal para autorizar más tablas en un caballo
  const [autorizandoCaballo, setAutorizandoCaballo] = useState<AnalisisCaballoRiesgo | null>(null);
  const [tablasAAutorizar, setTablasAAutorizar] = useState("5");
  const [motivoAutorizacion, setMotivoAutorizacion] = useState("Demanda de jugadores en taquilla/portal");
  const [procesandoAutorizacion, setProcesandoAutorizacion] = useState(false);

  // Edición rápida de máximos por caballo
  const [maximosPorCaballo, setMaximosPorCaballo] = useState<Record<string, string>>({});
  const [guardandoMaximos, setGuardandoMaximos] = useState(false);

  const cargarDatos = async (t: TablaFijaRow) => {
    setCargando(true);
    setErrorMsg("");
    try {
      const res = await obtenerAnalisisRiesgoTabla(t);
      setAnalisis(res);
      setCuposGruposEdit(res.cuposGrupos);

      const maxs: Record<string, string> = {};
      res.caballos.forEach((c) => {
        maxs[c.numero] = c.maxTablas !== null ? String(c.maxTablas) : "";
      });
      setMaximosPorCaballo(maxs);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error al cargar análisis de riesgo.");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (abierto && tabla) {
      void cargarDatos(tabla);
    }
  }, [abierto, tabla]);

  if (!abierto || !tabla) return null;

  const moneda = tabla.moneda || "USD";
  const hipo = nombreHipodromoParaMostrar(tabla.hipodromo);
  const carr = tabla.carrera ?? 1;

  const ejecutarGuardarGrupos = async () => {
    setGuardandoGrupos(true);
    setAviso("");
    setErrorMsg("");
    const filas = cuposGruposEdit.map((g) => ({
      grupo_id: g.grupo_id,
      cupos: g.cupos !== null && g.cupos !== undefined ? Number(g.cupos) : null,
      max: g.max !== null && g.max !== undefined ? Number(g.max) : null,
    }));
    const r = await guardarCuposTabla(tabla.id, filas);
    setGuardandoGrupos(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudieron guardar los cupos por grupo.");
      return;
    }
    setAviso("✅ Cupos por grupo actualizados y sincronizados con éxito.");
    void cargarDatos(tabla);
    onActualizado?.();
  };

  const ejecutarGuardarMaximoCaballo = async (caballoNumero: string) => {
    setGuardandoMaximos(true);
    setAviso("");
    setErrorMsg("");
    const val = maximosPorCaballo[caballoNumero];
    const maxNum = val !== "" && val !== undefined ? Math.max(0, parseInt(val, 10)) : null;

    const r = await guardarMaximoPorEjemplar(tabla.id, caballoNumero, maxNum);
    setGuardandoMaximos(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudo actualizar el límite del ejemplar.");
      return;
    }
    setAviso(`✅ Límite del ejemplar #${caballoNumero} guardado (${maxNum ?? "Sin tope"}).`);
    void cargarDatos(tabla);
    onActualizado?.(r.caballos);
  };

  const ejecutarAutorizarMasTablas = async () => {
    if (!autorizandoCaballo) return;
    const cant = parseInt(tablasAAutorizar, 10);
    if (!(cant > 0)) {
      setErrorMsg("Indique una cantidad válida de tablas a autorizar (mayor a 0).");
      return;
    }
    setProcesandoAutorizacion(true);
    setErrorMsg("");
    setAviso("");

    const r = await autorizarMasTablasEjemplar({
      tablaId: tabla.id,
      caballoNumero: autorizandoCaballo.numero,
      tablasAdicionales: cant,
      motivo: motivoAutorizacion,
    });

    setProcesandoAutorizacion(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudo autorizar más tablas.");
      return;
    }

    setAviso(
      `🔓 Se autorizaron +${cant} tablas adicionales en el caballo #${autorizandoCaballo.numero} (Nuevo cupo: ${r.nuevoTope}).`
    );
    setAutorizandoCaballo(null);
    void cargarDatos(tabla);
    onActualizado?.(r.caballos);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5 overflow-y-auto" role="dialog" aria-modal>
      <div className="my-auto w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 max-h-[94vh] flex flex-col">
        {/* CABECERA */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 px-5 py-3.5 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🛡️</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider">
                  Control de Riesgo, Cupos y Pérdida Máxima
                </h2>
                <span className="rounded-full bg-purple-500/30 border border-purple-300/40 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-200">
                  {hipo} · C{carr}
                </span>
              </div>
              <p className="text-[11px] text-purple-200/80">
                Monitorea la exposición financiera de la banca por carrera y administra cupos por grupo y por ejemplar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void cargarDatos(tabla)}
              disabled={cargando}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs font-bold text-white transition flex items-center gap-1"
              title="Recargar datos de compras y exposición"
            >
              🔄 {cargando ? "Actualizando…" : "Recargar"}
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs font-bold text-white"
              aria-label="Cerrar"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>

        {/* MENSAJES DE ESTADO */}
        {aviso && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-xs font-bold text-emerald-800 flex items-center justify-between">
            <span>{aviso}</span>
            <button onClick={() => setAviso("")} className="text-emerald-600 hover:text-emerald-900">✕</button>
          </div>
        )}
        {errorMsg && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 text-xs font-bold text-rose-800 flex items-center justify-between">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg("")} className="text-rose-600 hover:text-rose-900">✕</button>
          </div>
        )}

        {/* RESUMEN DE PÉRDIDA MÁXIMA Y EXPOSICIÓN (KPIS) */}
        {analisis && (
          <div className="bg-slate-50 border-b border-slate-200 p-4 shrink-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Recaudación Total */}
              <div className="rounded-xl border border-indigo-200 bg-white p-3 shadow-sm">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Total Recaudado en Carrera
                </div>
                <div className="mt-1 text-lg font-mono font-black text-indigo-700">
                  {formatoMoneda(moneda, analisis.totalRecaudadoCarrera)}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold">
                  {analisis.totalTablasVendidas} tabla(s) vendida(s) en total
                </div>
              </div>

              {/* Premio por Tabla */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Monto a Pagar Tabla (Premio)
                </div>
                <div className="mt-1 text-lg font-mono font-black text-slate-900">
                  {formatoMoneda(moneda, analisis.premioTabla)}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold">
                  Por cada tabla ganadora
                </div>
              </div>

              {/* Pérdida Máxima Posible */}
              <div className={`rounded-xl border p-3 shadow-sm ${
                analisis.peorEscenario && analisis.peorEscenario.perdidaMaxima > 0
                  ? "border-rose-300 bg-rose-50"
                  : "border-emerald-300 bg-emerald-50"
              }`}>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Pérdida Máxima Posible
                </div>
                <div className={`mt-1 text-lg font-mono font-black ${
                  analisis.peorEscenario && analisis.peorEscenario.perdidaMaxima > 0
                    ? "text-rose-700"
                    : "text-emerald-700"
                }`}>
                  {analisis.peorEscenario && analisis.peorEscenario.perdidaMaxima > 0
                    ? `-${formatoMoneda(moneda, analisis.peorEscenario.perdidaMaxima)}`
                    : "Sin pérdida (Cubierto)"}
                </div>
                <div className="text-[10px] font-semibold truncate text-slate-600">
                  {analisis.peorEscenario && analisis.peorEscenario.perdidaMaxima > 0
                    ? `Peor caso: #${analisis.peorEscenario.caballoNumero} ${analisis.peorEscenario.caballoNombre}`
                    : "Ganancia asegurada para la banca"}
                </div>
              </div>

              {/* Nivel de Exposición y Estado de Cupos */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col justify-between">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Estado de Riesgo & Cupos
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    analisis.haySobreexposicion
                      ? "bg-rose-100 text-rose-800 border border-rose-300"
                      : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  }`}>
                    {analisis.haySobreexposicion ? "🔴 Exposición Alta" : "🟢 Riesgo Controlado"}
                  </span>
                  {analisis.hayCupoAgotado && (
                    <span className="rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[10px] font-black uppercase animate-pulse">
                      ⚠️ Cupos Agotados
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑAS DE NAVEGACIÓN */}
        <div className="flex border-b border-slate-200 bg-white px-4 shrink-0">
          <button
            type="button"
            onClick={() => setTabActiva("ejemplares")}
            className={`border-b-2 px-4 py-2.5 text-xs font-black uppercase tracking-wide transition ${
              tabActiva === "ejemplares"
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            🐴 Matriz por Ejemplar ({analisis?.caballos.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setTabActiva("grupos")}
            className={`border-b-2 px-4 py-2.5 text-xs font-black uppercase tracking-wide transition ${
              tabActiva === "grupos"
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            👥 Cupos por Grupo ({cuposGruposEdit.length})
          </button>
        </div>

        {/* CUERPO PRINCIPAL */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: MATRIZ DE EJEMPLARES */}
          {tabActiva === "ejemplares" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                <span>
                  Control de exposición por caballo: define el máximo de tablas que se pueden vender por ejemplar para evitar pérdidas desmedidas.
                </span>
                <span className="text-[11px] text-slate-400">
                  💡 Balance neto = Recaudación Total - Pago si gana ese caballo
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                      <th className="py-2.5 px-3 w-12 text-center">#</th>
                      <th className="py-2.5 px-3">Ejemplar</th>
                      <th className="py-2.5 px-3 text-right">Valor Tabla</th>
                      <th className="py-2.5 px-3 text-center">Vendidas / Límite</th>
                      <th className="py-2.5 px-3 text-right">Recaudado</th>
                      <th className="py-2.5 px-3 text-right">Pago si Gana</th>
                      <th className="py-2.5 px-3 text-right">Balance Neto Banca</th>
                      <th className="py-2.5 px-3 text-center">Estado Cupo</th>
                      <th className="py-2.5 px-3 text-center">Configurar Máx.</th>
                      <th className="py-2.5 px-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analisis?.caballos.map((c) => {
                      const esNegativo = c.balanceNeto < 0;
                      return (
                        <tr
                          key={c.numero}
                          className={`transition ${
                            c.cupoAgotado
                              ? "bg-amber-50/60"
                              : c.nivelRiesgo === "CRITICO"
                                ? "bg-rose-50/40"
                                : "hover:bg-slate-50"
                          }`}
                        >
                          {/* Número */}
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold leading-none shadow-sm"
                              style={{
                                backgroundColor: colorDeNumero(c.numero),
                                color: textoDeNumero(c.numero),
                              }}
                            >
                              {c.numero}
                            </span>
                          </td>

                          {/* Nombre */}
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-800 uppercase flex items-center gap-1">
                              <span>{c.nombre}</span>
                              {c.nacionalidad && c.nacionalidad !== "VE" && (
                                <Flag nac={c.nacionalidad} size={11} withName={false} />
                              )}
                              {c.retirado && (
                                <span className="rounded bg-rose-100 text-rose-700 px-1 py-0.5 text-[8.5px] font-black uppercase">
                                  Retirado
                                </span>
                              )}
                              {c.invalidado && (
                                <span className="rounded bg-purple-100 text-purple-700 px-1 py-0.5 text-[8.5px] font-black uppercase">
                                  Invalidado
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Valor Tabla */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-600">
                            {formatoMoneda(moneda, c.valorUnitario)}
                          </td>

                          {/* Vendidas / Límite */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="inline-flex items-center gap-1">
                              <span className="font-mono font-black text-slate-900">
                                {c.tablasVendidas}
                              </span>
                              <span className="text-slate-400">/</span>
                              <span className="font-mono text-slate-500">
                                {c.maxTablas !== null ? c.maxTablas : "∞"}
                              </span>
                            </div>
                            {c.maxTablas !== null && (
                              <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    c.tablasVendidas >= c.maxTablas ? "bg-rose-500" : "bg-indigo-500"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, (c.tablasVendidas / (c.maxTablas || 1)) * 100)}%`,
                                  }}
                                />
                              </div>
                            )}
                          </td>

                          {/* Recaudado en este caballo */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                            {formatoMoneda(moneda, c.recaudadoCaballo)}
                          </td>

                          {/* Pago si gana */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700">
                            {formatoMoneda(moneda, c.pagoPotencial)}
                          </td>

                          {/* Balance Neto Banca */}
                          <td className="py-2.5 px-3 text-right font-mono font-black">
                            {c.retirado || c.invalidado ? (
                              <span className="text-slate-400">—</span>
                            ) : esNegativo ? (
                              <span className="text-rose-600 bg-rose-100/70 px-1.5 py-0.5 rounded">
                                -{formatoMoneda(moneda, Math.abs(c.balanceNeto))}
                              </span>
                            ) : (
                              <span className="text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded">
                                +{formatoMoneda(moneda, c.balanceNeto)}
                              </span>
                            )}
                          </td>

                          {/* Estado Cupo */}
                          <td className="py-2.5 px-3 text-center">
                            {c.cupoAgotado ? (
                              <span className="rounded-full bg-rose-100 border border-rose-300 px-2 py-0.5 text-[9.5px] font-black uppercase text-rose-700">
                                🚫 Agotado
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[9.5px] font-black uppercase text-emerald-700">
                                ✓ Abierto
                              </span>
                            )}
                          </td>

                          {/* Configurar Máximo por Ejemplar */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                placeholder="Sin tope"
                                value={maximosPorCaballo[c.numero] ?? ""}
                                onChange={(e) =>
                                  setMaximosPorCaballo((prev) => ({
                                    ...prev,
                                    [c.numero]: e.target.value,
                                  }))
                                }
                                className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono text-xs font-bold outline-none focus:border-purple-500"
                              />
                              <button
                                type="button"
                                onClick={() => void ejecutarGuardarMaximoCaballo(c.numero)}
                                disabled={guardandoMaximos}
                                title="Guardar límite para este ejemplar"
                                className="rounded bg-slate-200 hover:bg-slate-300 p-1 text-slate-700 transition"
                              >
                                💾
                              </button>
                            </div>
                          </td>

                          {/* Acciones: Autorizar más tablas y Ver quién compró */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Botón Autorizar Más Tablas */}
                              <button
                                type="button"
                                onClick={() => {
                                  setAutorizandoCaballo(c);
                                  setTablasAAutorizar("5");
                                }}
                                title="Autorizar venta de más tablas para este ejemplar"
                                className="rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-800 px-2 py-1 text-[10px] font-black uppercase transition"
                              >
                                ➕ Autorizar
                              </button>

                              {/* Botón Ver Compradores */}
                              <button
                                type="button"
                                onClick={() => setCaballoCompradores(c)}
                                title="Ver lista de quién ha comprado en este ejemplar"
                                className="rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-1 text-[10px] font-black uppercase transition"
                              >
                                👁️ ({c.compradores.length})
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: GESTIÓN DE CUPOS POR GRUPO DE VENTA */}
          {tabActiva === "grupos" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
                <span>
                  Control de tablas por grupo (Por defecto: 3 en Dólares · 3.000 grupo y 1.000 jugador en Bolívares).
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCuposGruposEdit((prev) =>
                        prev.map((x) => ({ ...x, cupos: 3, max: 3 }))
                      );
                    }}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                    title="Aplicar valores por defecto para Dólares: 3 tablas fijas"
                  >
                    💵 Defecto USD (3 tablas)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCuposGruposEdit((prev) =>
                        prev.map((x) => ({ ...x, cupos: 3000, max: 1000 }))
                      );
                    }}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                    title="Aplicar valores por defecto para Bolívares: 3.000 grupo / 1.000 jugador"
                  >
                    🇻🇪 Defecto VES (3.000 / 1.000)
                  </button>
                  <Button
                    size="sm"
                    onClick={() => void ejecutarGuardarGrupos()}
                    disabled={guardandoGrupos}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
                  >
                    {guardandoGrupos ? "Guardando…" : "💾 Guardar Cupos de Grupos"}
                  </Button>
                </div>
              </div>

              {cuposGruposEdit.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-xs">
                  No hay grupos asignados a esta carrera.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-left text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3">Grupo de Venta</th>
                        <th className="py-2.5 px-3 text-right">Cupo Total Tablas Asignado</th>
                        <th className="py-2.5 px-3 text-right">Máximo Tablas por Jugador</th>
                        <th className="py-2.5 px-3 text-right">Tablas Vendidas</th>
                        <th className="py-2.5 px-3 text-right">Cupo Restante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cuposGruposEdit.map((g, idx) => {
                        const total = g.cupos !== null && g.cupos !== undefined ? Number(g.cupos) : null;
                        const vendidas = Number(g.cantidad_vendida ?? 0);
                        const restante = total !== null ? Math.max(0, total - vendidas) : "Sin tope";
                        return (
                          <tr key={String(g.grupo_id)} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-bold uppercase text-slate-800">
                              {g.grupo_nombre || `Grupo #${g.grupo_id}`}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min={0}
                                value={g.cupos ?? ""}
                                placeholder="Sin tope"
                                onChange={(e) =>
                                  setCuposGruposEdit((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, cupos: parseNum(e.target.value) } : x
                                    )
                                  )
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono font-bold text-xs outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min={0}
                                value={g.max ?? ""}
                                placeholder="Sin tope"
                                onChange={(e) =>
                                  setCuposGruposEdit((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, max: parseNum(e.target.value) || null } : x
                                    )
                                  )
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono font-bold text-xs outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                              {vendidas}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  restante === 0
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {restante}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PIE */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 shrink-0">
          <span className="text-[11px] text-slate-500 font-semibold">
            {hipo} · Carrera {carr} · Todos los cambios de cupos y autorizaciones se auditan en el sistema.
          </span>
          <Button variant="default" size="sm" onClick={onCerrar}>
            Cerrar panel
          </Button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SUBMODAL: QUIÉN HA COMPRADO QUÉ EN ESTE CABALLO                     */}
      {/* =================================================================== */}
      {caballoCompradores && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setCaballoCompradores(null);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="bg-slate-900 px-4 py-3 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: colorDeNumero(caballoCompradores.numero),
                    color: textoDeNumero(caballoCompradores.numero),
                  }}
                >
                  {caballoCompradores.numero}
                </span>
                <span className="font-black text-sm uppercase">
                  Quién ha comprado: #{caballoCompradores.numero} {caballoCompradores.nombre}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCaballoCompradores(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Total Tablas:</span>
                  <span className="font-mono font-black text-slate-900">{caballoCompradores.tablasVendidas}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Total Recaudado:</span>
                  <span className="font-mono font-black text-indigo-700">
                    {formatoMoneda(moneda, caballoCompradores.recaudadoCaballo)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Premio si Gana:</span>
                  <span className="font-mono font-black text-rose-700">
                    {formatoMoneda(moneda, caballoCompradores.pagoPotencial)}
                  </span>
                </div>
              </div>

              {caballoCompradores.compradores.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">
                  No hay compras registradas todavía para este ejemplar.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-left text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3">Jugador</th>
                        <th className="py-2 px-3">Grupo</th>
                        <th className="py-2 px-3 text-center">Cant. Tablas</th>
                        <th className="py-2 px-3 text-right">Monto</th>
                        <th className="py-2 px-3 text-right">Premio si Gana</th>
                        <th className="py-2 px-3 text-center">Fecha / Hora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {caballoCompradores.compradores.map((comp, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-bold text-slate-800">{comp.clienteNombre}</td>
                          <td className="py-2 px-3 text-slate-600 font-semibold">{comp.grupoNombre}</td>
                          <td className="py-2 px-3 text-center font-mono font-black text-indigo-900">
                            {comp.cantidad}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-700">
                            {formatoMoneda(moneda, comp.monto)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                            {formatoMoneda(moneda, comp.premioPagar)}
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-500">
                            {comp.fechaHora}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 flex justify-end">
              <Button size="sm" onClick={() => setCaballoCompradores(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUBMODAL: AUTORIZAR MÁS TABLAS EN UN EJEMPLAR                       */}
      {/* =================================================================== */}
      {autorizandoCaballo && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setAutorizandoCaballo(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden border border-purple-300">
            <div className="bg-purple-700 px-4 py-3 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔓</span>
                <span className="font-black text-sm uppercase">
                  Autorizar Más Tablas: #{autorizandoCaballo.numero} {autorizandoCaballo.nombre}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAutorizandoCaballo(null)}
                className="text-purple-200 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-600 font-semibold">Cupo Actual:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {autorizandoCaballo.maxTablas !== null ? `${autorizandoCaballo.maxTablas} tablas` : "Sin tope"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-semibold">Tablas Vendidas:</span>
                  <span className="font-mono font-bold text-indigo-700">
                    {autorizandoCaballo.tablasVendidas} tablas
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-semibold">Estado:</span>
                  <span className="font-black text-rose-700">
                    {autorizandoCaballo.cupoAgotado ? "Cupo Agotado" : "Cupo Activo"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Cantidad de tablas adicionales a autorizar
                </label>
                <div className="flex gap-2 mb-2">
                  {[2, 5, 10, 20].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setTablasAAutorizar(String(num))}
                      className={`flex-1 py-1 rounded-lg border font-mono font-black text-xs transition ${
                        tablasAAutorizar === String(num)
                          ? "bg-purple-600 text-white border-purple-600 shadow"
                          : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                      }`}
                    >
                      +{num}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  value={tablasAAutorizar}
                  onChange={(e) => setTablasAAutorizar(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-right font-mono font-bold text-sm outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Motivo de la autorización (Auditoría)
                </label>
                <input
                  type="text"
                  value={motivoAutorizacion}
                  onChange={(e) => setMotivoAutorizacion(e.target.value)}
                  placeholder="Ej. Solicitud de jugadores en taquilla / portal"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setAutorizandoCaballo(null)}>
                Cancelar
              </Button>
              <Button
                variant="success"
                size="sm"
                disabled={procesandoAutorizacion}
                onClick={() => void ejecutarAutorizarMasTablas()}
                className="bg-purple-600 hover:bg-purple-500 text-white font-black"
              >
                {procesandoAutorizacion ? "Procesando…" : "🔓 Confirmar Autorización"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ControlRiesgoTablasModal;
