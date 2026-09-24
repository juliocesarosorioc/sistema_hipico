"use client";

import { useEffect, useMemo, useState } from "react";
import { detectarModalidad, parsearLineaRapida, proyectarFila } from "@/lib/taquilla/validar";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla, type ResLiquidarCarrera } from "@/lib/liquidacion/pagarYCerrar";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useHipodromosActivos } from "@/store/useHipodromosStore";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { SemaforoCarreras } from "@/components/gestion/SemaforoCarreras";
import { Button } from "@/components/ui/Button";
import { fmtMoney } from "@/lib/tablas/tipos";

type FilaCarga = {
  jugada: string;
  caballo: string;
  monto: string;
  cliente1: string;
  cliente2: string;
  disp1: string;
  disp2: string;
};

const filaVacia = (): FilaCarga => ({
  jugada: "",
  caballo: "",
  monto: "",
  cliente1: "",
  cliente2: "",
  disp1: "",
  disp2: "",
});

const MONEDA = "VES";

/**
 * Gestión de Jugadas — Taquilla (clon del legacy):
 *  - Carga Individual con columnas # | X | JUGADA | CABALLO | MONTO |
 *    CLIENTE 1 | CLIENTE 2 | DISP 1 | DISP 2 (sin COBRO, tipografía text-xs)
 *  - JUGADA solo nomenclatura pura (2x3 10/8 · 1p · 2n) + MONTO numérico aparte;
 *    el motor cruza la modalidad con el monto y proyecta el cobro por cliente
 *  - Modal Carga Rápida: textarea con bloque de texto (formato legacy) que el
 *    motor parsea línea por línea y puebla las filas automáticamente
 *  - Inputs: Retirados · COM % · Modalidad (Con Cruces) · Saldos Pozo/Traslado/Aval
 *  - Hipódromo buscable + Semáforo de carreras (gris/verde/amarillo/rojo)
 *  - Barra de comandos flotante con atajos: Ctrl+Q / Ctrl+Y / Ctrl+R / Ctrl+Shift+K
 *  - Liquidación con motor + 8 posiciones + Dead Heat (cero fraccionamiento)
 */
export function GestionJugadasModule() {
  const [hipodromo, setHipodromo] = useState("LA RINCONADA");
  const hipodromos = useHipodromosActivos();
  const [carrera, setCarrera] = useState(1);
  const [retirados, setRetirados] = useState("");
  const [comision, setComision] = useState("5");
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
  const [modalCargaRapida, setModalCargaRapida] = useState(false);
  const [textoCargaRapida, setTextoCargaRapida] = useState("");
  const [ultimaPizarra, setUltimaPizarra] = useState<PizarraResultados | null>(null);
  const [resumen, setResumen] = useState<ResLiquidarCarrera | null>(null);

  const tickets = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  const tablas = useTablasFijasStore((s) => s.tablas);

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

  const valida = (f: FilaCarga) => proyectarFila({ jugada: f.jugada, monto: f.monto, tasaComision: comisionNum });

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
    const errores: string[] = [];
    for (const f of filas) {
      if (!f.jugada.trim() && !f.monto.trim()) continue;
      const v = valida(f);
      if (!v.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${v.motivo}`);
        continue;
      }
      const mejorCobre = Math.max(v.cliente1?.cobroNeto ?? 0, v.cliente2?.cobroNeto ?? 0);
      const comisionMejor =
        v.cliente1 && v.cliente2 && (v.cliente2?.cobroNeto ?? 0) > (v.cliente1?.cobroNeto ?? 0)
          ? v.cliente2.comision
          : (v.cliente1?.comision ?? 0);
      agregarTicket({
        comando: `${v.monto} ${v.tipo}`,
        monto: v.monto,
        gananciaProyectada: round2(mejorCobre - v.monto),
        comision: comisionMejor,
      });
      n += 1;
    }
    if (n === 0) {
      return setAviso("Carga al menos una jugada válida (JUGADA + MONTO). " + (errores[0] ?? ""));
    }
    if (!jugadasPorCarrera.includes(carrera)) setJugadasPorCarrera((j) => [...j, carrera]);
    setFilas([filaVacia()]);
    setAviso(`✅ ${n} jugada(s) enviada(s) a la taquilla (C${carrera}).` + (errores.length ? ` ${errores.length} fila(s) con error ignorada(s).` : ""));
  };

  const poblarCargaRapida = () => {
    const lineas = textoCargaRapida.split("\n");
    const filasNuevas: FilaCarga[] = [];
    const errs: string[] = [];
    let ok = 0;
    for (const l of lineas) {
      const p = parsearLineaRapida(l);
      if (!p) continue;
      if (p.ok) {
        filasNuevas.push({
          jugada: p.jugada,
          caballo: p.caballo,
          monto: p.monto,
          cliente1: p.cliente1,
          cliente2: p.cliente2,
          disp1: "",
          disp2: "",
        });
        ok += 1;
      } else {
        errs.push(`${l.trim()} → ${p.motivo}`);
      }
    }
    if (filasNuevas.length > 0) {
      setFilas(filasNuevas);
      setTextoCargaRapida("");
      setModalCargaRapida(false);
      setAviso(`⚡ ${ok} fila(s) poblada(s) desde el bloque de texto.` + (errs.length ? ` ${errs.length} línea(s) con error ignorada(s).` : ""));
    } else {
      setAviso("⚠️ No se pudieron parsear líneas válidas. " + (errs[0] ?? ""));
    }
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
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 lg:grid-cols-5">
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
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-[4%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">#</th>
              <th className="w-[3%] border-r border-slate-700 px-1 py-1 text-center font-bold uppercase">X</th>
              <th className="w-[22%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Jugada</th>
              <th className="w-[10%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Caballo</th>
              <th className="w-[13%] border-r border-slate-700 px-1 py-1 text-right font-bold uppercase">Monto</th>
              <th className="w-[16%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Cliente 1</th>
              <th className="w-[16%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Cliente 2</th>
              <th className="w-[8%] border-r border-slate-700 px-1 py-1 text-right font-bold uppercase">Disp 1</th>
              <th className="w-[8%] px-1 py-1 text-right font-bold uppercase">Disp 2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {filas.map((f, i) => {
              const v = valida(f);
              const detectado = f.jugada.trim() ? detectarModalidad(f.jugada) : null;
              return (
                <tr key={i} className="align-middle">
                  <td className="px-1 py-0.5 text-xs text-slate-400">{i + 1}</td>
                  <td className="px-1 py-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                      disabled={filas.length <= 1}
                      aria-label="Eliminar fila"
                      className="text-xs text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.jugada}
                      onChange={(e) => setFila(i, { jugada: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          cargarAtaquilla();
                        }
                      }}
                      placeholder="2x3 10/8 · 1p · 2n"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <span
                      className={`mt-0.5 block truncate text-[9px] font-black uppercase tracking-wide ${
                        v.ok ? "text-emerald-600" : "text-slate-300"
                      }`}
                    >
                      {detectado ?? (f.jugada.trim() ? "—" : "")}
                    </span>
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.caballo}
                      onChange={(e) => setFila(i, { caballo: e.target.value })}
                      placeholder="Nº"
                      inputMode="numeric"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.monto}
                      onChange={(e) => setFila(i, { monto: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-right text-xs font-black text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.cliente1}
                      onChange={(e) => setFila(i, { cliente1: e.target.value })}
                      placeholder="Cliente 1…"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    {v.ok && v.cliente1 && (
                      <span className="mt-0.5 block truncate text-[9px] font-black text-emerald-600">
                        Cobra {monedaFmt(v.cliente1.cobroNeto)}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.cliente2}
                      onChange={(e) => setFila(i, { cliente2: e.target.value })}
                      placeholder="Cliente 2…"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    {v.ok && v.cliente2 && (
                      <span className="mt-0.5 block truncate text-[9px] font-black text-emerald-600">
                        Cobra {monedaFmt(v.cliente2.cobroNeto)}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.disp1}
                      onChange={(e) => setFila(i, { disp1: e.target.value })}
                      placeholder="0"
                      inputMode="numeric"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-right text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={f.disp2}
                      onChange={(e) => setFila(i, { disp2: e.target.value })}
                      placeholder="0"
                      inputMode="numeric"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-right text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModalCargaRapida(true)}>
            ⚡ Carga Rápida <span className="ml-1 rounded bg-warning-500/20 px-1.5 text-[9px] font-black text-warning-700">texto</span>
          </Button>
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

      {/* Carga Rápida (texto libre) — pegar bloque y poblar tabla */}
      {modalCargaRapida && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">⚡ Carga Rápida — {hipodromo} C{carrera}</h3>
              <button type="button" onClick={() => setModalCargaRapida(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <textarea
                value={textoCargaRapida}
                onChange={(e) => setTextoCargaRapida(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={"Pegá el bloque de jugadas (1 por línea):\n\n1/2 4 60 Camacho rucio\n2n 7 25 Eddie Manuel\n1/2 y 2n 7 100 Eddie Manuel\n2x3 10/8 2 100 Juan Pedro"}
                className="w-full resize-y rounded-xl border border-line bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
              <p className="text-[10px] font-semibold text-slate-500">
                Formato por línea: <b>JUGADA CABALLO MONTO CLIENTE1 [CLIENTE2]</b> — p. ej. <i>2x3 10/8 2 100 Juan Pedro</i>. El
                motor parsea el bloque línea por línea y puebla automáticamente las filas de la tabla.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => { setTextoCargaRapida(""); setModalCargaRapida(false); }}>
                Cancelar
              </Button>
              <Button variant="success" size="md" onClick={poblarCargaRapida}>📥 Poblar tabla</Button>
            </div>
          </div>
        </div>
      )}

      {/* Evento Enter en barras superiores no debe recargar */}
      <input type="hidden" />
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Color de casaca por número (paleta ligera para el preliminar). */
function cardColor(n: string | number): string {
  const i = ((Number(n) || 1) - 1) % 14;
  return ["#dc2626", "#f5f5f4", "#2563eb", "#facc15", "#16a34a", "#111827", "#f97316", "#f9a8d4", "#22d3ee", "#9333ea", "#6b7280", "#4ade80", "#92400e", "#7f1d1d"][i < 0 ? 0 : i];
}

export default GestionJugadasModule;