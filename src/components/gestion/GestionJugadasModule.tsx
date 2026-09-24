"use client";

import { useEffect, useMemo, useState } from "react";
import { validarComando } from "@/lib/taquilla/validar";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla, type ResLiquidarCarrera } from "@/lib/liquidacion/pagarYCerrar";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { listarHipodromos } from "@/lib/tablas/rpc";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { SemaforoCarreras } from "@/components/gestion/SemaforoCarreras";
import { Button } from "@/components/ui/Button";
import { fmtMoney } from "@/lib/tablas/tipos";

type FilaCarga = {
  jugada: string;
  juega: string;
  consigue: string;
  disp1: string;
  disp2: string;
};

const filaVacia = (): FilaCarga => ({ jugada: "", juega: "", consigue: "", disp1: "", disp2: "" });

const MODALIDADES = ["NINI", "PUESTO", "A PREMIO", "COMBINADA", "COMPUESTA"];

const MONEDA = "VES";

/**
 * Gestión de Jugadas — Taquilla (clon del legacy):
 *  - Carga Individual con columnas # | X | JUGADA | CABALLO | MONTO | COBRO |
 *    JUEGA (CLIENTE 1) | CONSIGUE (CLIENTE 2) | DISP 1 | DISP 2
 *  - Inputs: Retirados · COM % · Modalidad (Con Cruces) · Saldos Pozo/Traslado/Aval
 *  - Hipódromo buscable + Semáforo de carreras (gris/verde/amarillo/rojo)
 *  - Barra de comandos flotante con atajos: Ctrl+Q / Ctrl+Y / Ctrl+R / Ctrl+Shift+K
 *  - Liquidación con motor + 8 posiciones + Dead Heat (cero fraccionamiento)
 */
export function GestionJugadasModule() {
  const [hipodromo, setHipodromo] = useState("LA RINCONADA");
  const [hipodromos, setHipodromos] = useState<Array<{ value: string; label: string }>>([]);
  const [carrera, setCarrera] = useState(1);
  const [retirados, setRetirados] = useState("");
  const [comision, setComision] = useState("5");
  const [modalidad, setModalidad] = useState("NINI");
  const [conCruces, setConCruces] = useState(false);
  const [saldoActivo, setSaldoActivo] = useState<"POZO" | "TRASLADO" | "AVAL">("POZO");
  const [saldos, setSaldos] = useState<Record<"POZO" | "TRASLADO" | "AVAL", string>>({
    POZO: "1200,50",
    TRASLADO: "0,00",
    AVAL: "0,00",
  });
  const [filas, setFilas] = useState<FilaCarga[]>([filaVacia()]);
  const [aviso, setAviso] = useState("");
  const [jugadasPorCarrera, setJugadasPorCarrera] = useState<number[]>([]);

  const [modalPreliminar, setModalPreliminar] = useState(false);
  const [modalResultados, setModalResultados] = useState(false);
  const [modalFinalizar, setModalFinalizar] = useState(false);
  const [modalComandos, setModalComandos] = useState(false);
  const [ultimaPizarra, setUltimaPizarra] = useState<PizarraResultados | null>(null);
  const [resumen, setResumen] = useState<ResLiquidarCarrera | null>(null);

  const tickets = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  const tablas = useTablasFijasStore((s) => s.tablas);

  useEffect(() => {
    listarHipodromos().then(setHipodromos);
  }, []);

  // Atajos de la Barra de Comandos (real keyboard events)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "q") {
        e.preventDefault();
        setModalPreliminar(true);
      } else if (k === "y") {
        e.preventDefault();
        setModalResultados(true);
      } else if (k === "r") {
        e.preventDefault();
        setModalFinalizar(true);
      } else if (k === "k" && e.shiftKey) {
        e.preventDefault();
        setModalComandos(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const comisionNum = useMemo(() => {
    const n = parseFloat(comision.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }, [comision]);

  const valida = (jugada: string) => validarComando(jugada, comisionNum);

  const tablaDeCarrera = useMemo(
    () =>
      tablas.find(
        (t) =>
          (t.hipodromo ?? "").toUpperCase().replace(/\s+/g, "") === hipodromo.toUpperCase().replace(/\s+/g, "") &&
          t.carrera === carrera
      ),
    [tablas, hipodromo, carrera]
  );

  const monedaFmt = (n: number): string =>
    fmtMoney(Number.isFinite(n) ? n : 0, MONEDA);

  const ticketsDeCarrera = useMemo(
    () => tickets.filter((t) => !/^TABLA /i.test(t.comando)),
    [tickets]
  );

  const totalInvertidoSesion = useMemo(
    () => ticketsDeCarrera.reduce((a, t) => a + t.monto, 0),
    [ticketsDeCarrera]
  );

  const setFila = (i: number, patch: Partial<FilaCarga>) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const cargarAtaquilla = () => {
    let n = 0;
    for (const f of filas) {
      const v = valida(f.jugada);
      if (!v.ok || !f.jugada.trim()) continue;
      agregarTicket({
        comando: `${v.monto} ${v.tipo}`,
        monto: v.monto,
        gananciaProyectada: v.proyeccion.gananciaProyectada,
        comision: v.proyeccion.comision,
      });
      n += 1;
    }
    if (n === 0) return setAviso("Carga al menos una jugada válida (formato: <monto> <jugada>, ej: 100 2n).");
    if (!jugadasPorCarrera.includes(carrera)) setJugadasPorCarrera((j) => [...j, carrera]);
    setFilas([filaVacia()]);
    setAviso(`✅ ${n} jugada(s) enviada(s) a la taquilla (C${carrera}).`);
  };

  const ejecutarFinalizar = async () => {
    if (!ultimaPizarra) {
      setModalFinalizar(false);
      setModalResultados(true);
      return setAviso("Primero cargá los resultados (Ctrl+Y) para liquidar.");
    }
    if (ticketsDeCarrera.length === 0) return setAviso("No hay jugadas en sesión para esta carrera.");
    const r = await liquidarCarreraYCerrarTabla({
      hipodromo,
      carrera,
      pizarra: ultimaPizarra.pizarra,
      tickets: ticketsDeCarrera.map((t) => ({ comando: t.comando, monto: t.monto })),
      tasaComision: comisionNum,
    });
    setResumen(r);
    if (r.ok) {
      for (const t of ticketsDeCarrera) eliminarTicket(t.id);
      setUltimaPizarra(null);
      setJugadasPorCarrera((j) => j.filter((c) => c !== carrera));
      setResumen(r);
    }
    setAviso(r.ok ? `✅ ${r.motivo}` : `❌ ${r.motivo}`);
  };

  const cerrarFinalizar = () => {
    setModalFinalizar(false);
    setResumen(null);
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black uppercase text-slate-900">🎟️ Gestión de Jugadas (Taquilla)</h2>
          <p className="text-xs text-slate-500">Carga individual + liquidación con motor (8 posiciones · Dead Heat).</p>
        </div>
        <div className="flex items-center gap-2">
          {(["POZO", "TRASLADO", "AVAL"] as const).map((nombre) => {
            const activo = saldoActivo === nombre;
            return (
              <button
                key={nombre}
                type="button"
                onClick={() => setSaldoActivo(nombre)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-black transition-colors ${
                  activo ? "border-primary-500 bg-primary-500/10 text-primary-700" : "border-line bg-surface text-slate-500"
                }`}
              >
                <span className="uppercase">{nombre}</span>
                <input
                  value={saldos[nombre]}
                  onChange={(e) => setSaldos((s) => ({ ...s, [nombre]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                  inputMode="decimal"
                  className="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right font-black text-slate-900"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Inputs superiores */}
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Hipódromo</label>
          <SearchableSelect
            options={hipodromos}
            value={hipodromo}
            onChange={setHipodromo}
            placeholder="Buscar hipódromo…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Retirados</label>
          <input
            value={retirados}
            onChange={(e) => setRetirados(e.target.value)}
            placeholder='ej. "2,5"'
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">COM %</label>
          <input
            value={comision}
            onChange={(e) => setComision(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Modalidad</label>
          <select
            value={modalidad}
            onChange={(e) => setModalidad(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {MODALIDADES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-end gap-2 pb-2 text-xs font-bold uppercase text-slate-600">
          <input
            type="checkbox"
            checked={conCruces}
            onChange={(e) => setConCruces(e.target.checked)}
            className="h-4 w-4 accent-primary-500"
          />
          Con Cruces
        </label>
        <div className="rounded-xl border border-line bg-gray-50 px-3 py-2 text-right">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">En sesión</p>
          <p className="text-sm font-black text-slate-900">{monedaFmt(totalInvertidoSesion)}</p>
          <p className="text-[9px] text-slate-400">{ticketsDeCarrera.length} ticket(s) · <span className="font-semibold text-slate-600">C{carrera}</span></p>
        </div>
      </div>

      <SemaforoCarreras hipodromo={hipodromo} activa={carrera} onSeleccionar={setCarrera} />

      {/* Tabla de Carga Individual (clon 1:1 del legacy) */}
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Carga Individual</h3>
          <span className="text-[10px] font-semibold text-slate-500">
            {hipodromo} · C{carrera} · Retirados: {retirados.trim() || "—"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="w-8 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">#</th>
                <th className="w-8 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">X</th>
                <th className="w-28 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">Jugada</th>
                <th className="w-28 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">Caballo</th>
                <th className="w-20 border-r border-slate-700 px-2 py-1.5 text-right font-bold uppercase">Monto</th>
                <th className="w-24 border-r border-slate-700 px-2 py-1.5 text-right font-bold uppercase">Cobro</th>
                <th className="w-24 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">Juega (Cliente 1)</th>
                <th className="w-24 border-r border-slate-700 px-2 py-1.5 text-left font-bold uppercase">Consigue (Cliente 2)</th>
                <th className="w-16 border-r border-slate-700 px-2 py-1.5 text-right font-bold uppercase">Disp 1</th>
                <th className="w-16 px-2 py-1.5 text-right font-bold uppercase">Disp 2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {filas.map((f, i) => {
                const v = valida(f.jugada);
                return (
                  <tr key={i} className="align-middle">
                    <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                        disabled={filas.length <= 1}
                        aria-label="Eliminar fila"
                        className="text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={f.jugada}
                        onChange={(e) => setFila(i, { jugada: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            cargarAtaquilla();
                          }
                        }}
                        placeholder="100 2n"
                        className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </td>
                    <td className="px-1 py-1 text-sm font-semibold text-slate-600">
                      {v.ok ? (tablaDeCarrera?.caballos ?? []).find((c) => String(c.numero) === String(v.tipo.replace(/[a-z]+\s*/gi, "").trim()))?.nombre ?? `Nº ${v.tipo.split(/\s+|\//)[0]}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-sm font-black text-slate-900">{v.ok ? v.monto : "—"}</td>
                    <td className="px-2 py-1 text-right text-sm font-black text-success-600">
                      {v.ok ? monedaFmt(Math.max(0, v.proyeccion.totalClienteNeto)) : "—"}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={f.juega}
                        onChange={(e) => setFila(i, { juega: e.target.value })}
                        placeholder="Cliente 1…"
                        className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={f.consigue}
                        onChange={(e) => setFila(i, { consigue: e.target.value })}
                        placeholder="Cliente 2…"
                        className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={f.disp1}
                        onChange={(e) => setFila(i, { disp1: e.target.value })}
                        placeholder="0"
                        inputMode="numeric"
                        className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-right text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={f.disp2}
                        onChange={(e) => setFila(i, { disp2: e.target.value })}
                        placeholder="0"
                        inputMode="numeric"
                        className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-right text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setFilas((f) => [...f, filaVacia()])}>＋ Agregar fila</Button>
          <Button variant="success" size="md" className="ml-auto" onClick={cargarAtaquilla}>
            📥 Cargar jugada(s) en la taquilla
          </Button>
        </div>
        {aviso && <p className="mt-2 text-xs font-semibold text-slate-600">{aviso}</p>}
      </div>

      {/* Barra de comandos flotante (sticky bottom) */}
      <div className="no-print sticky bottom-0 z-30 -mx-4 border-t border-line bg-slate-900 px-4 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] lg:-mx-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setModalPreliminar(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            📋 Preliminar <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+Q</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalResultados(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            🏁 Carga de Resultados <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+Y</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalFinalizar(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-success-600 to-emerald-500 px-3 py-2 text-xs font-black text-white hover:brightness-110"
          >
            ✅ Registrar y Finalizar <kbd className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-black">Ctrl+R</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalComandos(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            ⌨️ Comandos <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+⇧+K</kbd>
          </button>
          <span className="ml-auto hidden text-[10px] font-semibold text-slate-500 sm:block">
            Saldo activo: <b className="text-slate-300">{saldoActivo}</b> · <b className="text-slate-300">{saldos[saldoActivo]}</b> {MONEDA}
          </span>
        </div>
      </div>

      {/* Modal Preliminar de Carrera (Ctrl+Q) */}
      {modalPreliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">📋 Preliminar de Carrera — {hipodromo} C{carrera}</h3>
              <button type="button" onClick={() => setModalPreliminar(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[9px] font-bold uppercase text-slate-400">Retirados</p>
                  <p className="font-bold text-slate-800">{retirados.trim() || "NO HUBO RETIROS"}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[9px] font-bold uppercase text-slate-400">Comisión</p>
                  <p className="font-bold text-slate-800">{comisionNum}%</p>
                </div>
              </div>
              <div className="rounded-lg border border-line">
                <p className="border-b border-line bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-500">
                  Ejemplares inscritos ({tablaDeCarrera?.caballos?.length ?? 0})
                </p>
                <ul className="max-h-56 divide-y divide-line/60 overflow-y-auto px-3 py-1">
                  {(tablaDeCarrera?.caballos?.length
                    ? tablaDeCarrera.caballos
                    : []
                  ).map((c, i) => (
                    <li key={i} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className="grid h-6 w-8 place-items-center rounded text-[10px] font-black text-white"
                        style={{ backgroundColor: c.retirado ? "#ef4444" : cardColor(c.numero) }}>
                        {c.numero}
                      </span>
                      <span className={`font-bold uppercase text-slate-800 ${c.retirado ? "line-through opacity-50" : ""}`}>{c.nombre}</span>
                      {c.retirado && <span className="ml-auto rounded bg-red-100 px-1.5 text-[9px] font-black text-red-600">RET.</span>}
                    </li>
                  ))}
                  {!tablaDeCarrera && (
                    <li className="py-4 text-center text-xs italic text-slate-400">Sin tabla publicada para esta carrera en el módulo Tablas Fijas.</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="flex justify-end border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" onClick={() => setModalPreliminar(false)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Carga de Resultados (Ctrl+Y) — 8 posiciones + Dead Heat */}
      <CargaResultadosModal
        abierto={modalResultados}
        onCerrar={() => setModalResultados(false)}
        hipodromo={hipodromo}
        carrera={String(carrera)}
        caballos={tablaDeCarrera?.caballos ?? null}
        onConfirmar={(r) => {
          setUltimaPizarra(r);
          setModalResultados(false);
          setAviso(`🏁 Resultados C${carrera} cargados (${r.llenas} posiciones${r.empates.length ? ` · ${r.empates.length} empate(s)` : ""}).`);
        }}
      />

      {/* Registrar y Finalizar (Ctrl+R) */}
      {modalFinalizar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✅ Registrar y Finalizar — {hipodromo} C{carrera}</h3>
              <button type="button" onClick={cerrarFinalizar} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
              {!ultimaPizarra ? (
                <p className="rounded-lg bg-warning-500/10 px-3 py-2 text-xs font-semibold text-warning-700">
                  ⚠️ Todavía no cargaste los resultados. Usá Ctrl+Y (Carga de Resultados) o confirmá abajo para abrir el modal.
                </p>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 p-3">
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Pizarra cargada ({ultimaPizarra.llenas} posiciones)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(ultimaPizarra.pizarra)
                      .filter(([k, v]) => k !== "empates" && typeof v === "string" && v.trim() !== "")
                      .map(([k, v]) => (
                        <span key={k} className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black uppercase text-white">
                          {k}: <b>{v}</b>
                        </span>
                      ))}
                    {ultimaPizarra.empates.length > 0 && (
                      <span className="rounded-md bg-warning-500 px-2 py-1 text-[10px] font-black uppercase text-white">
                        ⚡ Empates: {ultimaPizarra.empates.join(", ")} (cero fraccionamiento)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {resumen ? (
                <div className="rounded-2xl border border-line p-3">
                  <p className="text-xs font-black uppercase text-slate-700">{resumen.ok ? "Resumen de la liquidación" : "Liquidación incompleta"}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Invertido</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.totalInvertido)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">A pagar (neto)</p>
                      <p className="font-black text-success-600">{monedaFmt(resumen.totalClienteNeto)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Balance de la banca</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.balanceBanca)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Comisión de la casa</p>
                      <p className="font-black text-primary-700">{monedaFmt(resumen.gananciaCasa)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] font-semibold text-slate-500">
                    {resumen.motivo} {resumen.tablaCerrada?.ok ? "· Tabla cerrada en BD ✔" : "· No se pudo cerrar la tabla en BD."}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  {ticketsDeCarrera.length} ticket(s) en sesión · Invertido: <b>{monedaFmt(totalInvertidoSesion)}</b>. Al
                  confirmar, el motor liquida con la pizarra y cierra la carrera automáticamente.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={cerrarFinalizar}>Cerrar</Button>
              {!resumen && (
                <>
                  <Button size="sm" onClick={() => { setModalFinalizar(false); setModalResultados(true); }}>
                    🏁 Cargar resultados
                  </Button>
                  <Button variant="success" size="md" onClick={ejecutarFinalizar}>
                    💰 Registrar y Finalizar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comandos (Ctrl+Shift+K) */}
      {modalComandos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">⌨️ Comandos de la Taquilla</h3>
              <button type="button" onClick={() => setModalComandos(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="divide-y divide-line p-2">
              {[
                ["Ctrl+Q", "📋 Preliminar de Carrera", "Muestra ejemplares inscritos de la carrera activa."],
                ["Ctrl+Y", "🏁 Carga de Resultados", "Pizarra con 8 posiciones + Empate (Dead Heat) por posición."],
                ["Ctrl+R", "✅ Registrar y Finalizar", "Liquida los tickets con el motor y cierra la carrera (estado= Cerrada)."],
                ["Ctrl+Shift+K", "⌨️ Comandos", "Este listado de atajos."],
              ].map(([kbd, titulo, desc]) => (
                <div key={kbd} className="flex items-start gap-3 px-2 py-2.5">
                  <kbd className="mt-0.5 shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black text-white">{kbd}</kbd>
                  <div>
                    <p className="text-xs font-bold text-slate-800">{titulo}</p>
                    <p className="text-[11px] text-slate-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" onClick={() => setModalComandos(false)}>Entendido</Button>
            </div>
          </div>
        </div>
      )}

      {/* Evento Enter en barras superiores no debe recargar */}
      <input type="hidden" />
    </div>
  );
}

/** Color de casaca por número (paleta ligera para el preliminar). */
function cardColor(n: string | number): string {
  const i = ((Number(n) || 1) - 1) % 14;
  return ["#dc2626", "#f5f5f4", "#2563eb", "#facc15", "#16a34a", "#111827", "#f97316", "#f9a8d4", "#22d3ee", "#9333ea", "#6b7280", "#4ade80", "#92400e", "#7f1d1d"][i < 0 ? 0 : i];
}

export default GestionJugadasModule;