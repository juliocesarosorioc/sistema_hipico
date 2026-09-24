"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { hoyLocal, leerProgramaPorFecha } from "@/lib/gaceta/programa";
import {
  CONDICIONES_MARCAS_DEFECTO,
  filasMarcaDefecto,
  guardarMarcas,
  leerMarcas,
  type FilaMarca,
} from "@/lib/marcas";
import { liquidarMarcas, parsearMarcasLista } from "@/lib/motores/marcas";
import type { TicketMotor } from "@/lib/bettingEngine";

const cellInput =
  "w-full rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-400";

export function MarcasModule() {
  const [hipodromos, setHipodromos] = useState<OpcionHipodromo[]>([]);
  const [hipodromo, setHipodromo] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());

  const [filas, setFilas] = useState<FilaMarca[]>(filasMarcaDefecto());
  const [condiciones, setCondiciones] = useState<string>(CONDICIONES_MARCAS_DEFECTO);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const [reporte, setReporte] = useState<string | null>(null);

  const [simRow, setSimRow] = useState("1");
  const [simGanador, setSimGanador] = useState("");
  const [simRes, setSimRes] = useState<string | null>(null);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  useEffect(() => {
    let v = true;
    void listarHipodromos().then((hs) => {
      if (!v) return;
      setHipodromos(hs);
      if (hs.length && !hipodromo) setHipodromo(hs[0].value);
    });
    return () => {
      v = false;
    };
  }, [hipodromo]);

  useEffect(() => {
    if (!hipodromo) return;
    let v = true;
    setCargando(true);
    void (async () => {
      const r = await leerMarcas(hipodromo, fecha);
      if (!v) return;
      if (r.ok && r.datos && r.datos.filas.length) {
        setFilas(r.datos.filas);
        setCondiciones(r.datos.condiciones || CONDICIONES_MARCAS_DEFECTO);
        setGuardado(true);
      } else {
        const p = await leerProgramaPorFecha(fecha);
        const hs = (p.ok && p.data?.carreras || [])
          .filter((c) => String(c.hipodromo || "").trim().toUpperCase() === String(hipodromo).toUpperCase())
          .sort((a, b) => (Number(a.carrera) || 0) - (Number(b.carrera) || 0));
        if (v) {
          setFilas(
            hs.length
              ? hs.map((c) => ({ carrera: String(c.carrera ?? ""), marcadas: "", contra: "" }))
              : filasMarcaDefecto()
          );
          setCondiciones(CONDICIONES_MARCAS_DEFECTO);
          setGuardado(false);
        }
      }
      if (v) setCargando(false);
    })();
    return () => {
      v = false;
    };
  }, [hipodromo, fecha]);

  const setFila = (i: number, patch: Partial<FilaMarca>) =>
    setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  const agregarFila = () =>
    setFilas((fs) => {
      const max = fs.reduce((a, f) => Math.max(a, Number(f.carrera) || 0), 0);
      return [...fs, { carrera: String(max + 1), marcadas: "", contra: "" }];
    });

  const quitarFila = (i: number) => setFilas((fs) => (fs.length > 1 ? fs.filter((_, k) => k !== i) : fs));

  const guardar = async () => {
    if (!hipodromo) return toast("Seleccione el hipódromo.", "warning");
    setGuardando(true);
    const r = await guardarMarcas({ hipodromo, fecha, filas, condiciones });
    setGuardando(false);
    if (r.ok) {
      setGuardado(true);
      toast(`✅ Marcas de ${hipodromo} · ${fecha} guardadas.`, "success");
    } else {
      toast("Error al guardar Marcas: " + (r.error || "desconocido"), "error");
    }
  };

  const generarReporte = () => {
    if (!hipodromo) return toast("Seleccione el hipódromo antes de generar el reporte.", "warning");
    const lineas: string[] = [];
    lineas.push(`🎯 MARCAS — ${hipodromo.toUpperCase()} · ${fecha}`);
    lineas.push("💵 PAGA 120 P/100 · ORDEN OFICIAL · 15 MIN DE VIGENCIA");
    lineas.push("");
    filas.forEach((f) => {
      lineas.push(
        `${String(f.carrera || "?").padEnd(3)}  MARCAS: ${f.marcadas.trim() || "—"}   NV   CONTRA: ${f.contra.trim() || "—"}`
      );
    });
    lineas.push("");
    lineas.push("CONDICIONES:");
    lineas.push(condiciones.trim() || CONDICIONES_MARCAS_DEFECTO);
    setReporte(lineas.join("\n"));
  };

  const copiarReporte = async () => {
    if (!reporte) return;
    try {
      await navigator.clipboard.writeText(reporte);
      toast("📋 Reporte copiado al portapapeles.", "success");
    } catch {
      toast("No se pudo copiar el reporte.", "error");
    }
  };

  const enviarWhatsApp = () => {
    if (!reporte) return;
    window.open("https://wa.me/?text=" + encodeURIComponent(reporte), "_blank");
  };

  const simular = () => {
    const fila = filas[Number(simRow) - 1] || filas[0];
    if (!fila) return toast("No hay filas para simular.", "warning");
    if (!fila.marcadas.trim()) return toast("Ingrese los marcados de la fila a simular.", "warning");
    if (!simGanador.trim()) return toast("Ingrese el ejemplar ganador a simular.", "warning");
    const ganador = simGanador.trim();
    const ticket = {
      hipodromo,
      carrera: fila.carrera,
      tipo_jugada: "marca",
      caballo: ganador,
      monto: 120,
      fechas: [],
      id: "sim",
      cruces: 1,
      cuota: null,
      total: 120,
      addedAt: Date.now(),
      puesto_final: 1,
      pizarra: { primero: ganador },
      dividendos: null,
      marcas: {
        marcados: parsearMarcasLista(fila.marcadas),
        contra: parsearMarcasLista(fila.contra),
      },
    } as unknown as TicketMotor;
    const r = liquidarMarcas(ticket, undefined, 5);
    setSimRes(
      r.ok
        ? `✅ Juega 120 → bruto $${(120 * (1 + 100 / 120)).toFixed(2)} − 5% → neto $${r.totalClienteNeto.toFixed(2)}`
        : `❌ ${r.motivo}`
    );
  };

  return (
    <div className="space-y-4">
      <ToastHost />

      {/* Cabecera de configuración — tonos verdes */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-700 px-4 py-3 text-white shadow-sm">
        <span className="text-2xl">🏷️</span>
        <div>
          <h2 className="text-lg font-extrabold uppercase tracking-wide">Marcas · 120 P/100</h2>
          <p className="text-xs font-medium text-emerald-100">
            Retos y proporciones diarias — orden oficial, no valen debutantes.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={hipodromo}
            onChange={(e) => {
              setHipodromo(e.target.value);
              setGuardado(false);
            }}
            className="rounded-lg border border-emerald-400/60 bg-white px-2 py-1.5 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <option value="">Hipódromo…</option>
            {hipodromos.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value || hoyLocal());
              setGuardado(false);
            }}
            className="rounded-lg border border-emerald-400/60 bg-white px-2 py-1.5 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          />
        </div>
      </div>

      {/* Tabla diaria */}
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full border-collapse table-fixed">
            <thead className="sticky top-0 z-10">
              <tr className="bg-emerald-600 text-emerald-50">
                <th className="w-14 border border-emerald-700 px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
                  Nº
                </th>
                <th className="border border-emerald-700 px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
                  Marcas <span className="text-emerald-300">( / )</span>
                </th>
                <th className="w-24 border border-emerald-700 px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
                  Leyenda
                </th>
                <th className="border border-emerald-700 px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
                  Contra <span className="text-emerald-300">( , )</span>
                </th>
                <th className="w-10 border border-emerald-700 px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
                  —
                </th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-xs font-semibold text-slate-500">
                    Cargando jornada de marcas…
                  </td>
                </tr>
              )}
              {!cargando &&
                filas.map((f, i) => (
                  <tr
                    key={i}
                    className={i % 2 ? "bg-emerald-50/60" : "bg-white"}
                  >
                    <td className="border border-emerald-100 px-1 py-0.5 text-center text-[11px] font-extrabold text-emerald-700">
                      {Number(f.carrera) || f.carrera}
                    </td>
                    <td className="border border-emerald-100 px-0.5 py-0.5">
                      <input
                        value={f.marcadas}
                        onChange={(e) => {
                          setFila(i, { marcadas: e.target.value });
                          setGuardado(false);
                        }}
                        placeholder="ej. 2/3/7/1/5"
                        className={cellInput}
                      />
                    </td>
                    <td className="border border-emerald-100 px-0.5 py-0.5 text-center">
                      <span className="inline-block rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                        NV
                      </span>
                    </td>
                    <td className="border border-emerald-100 px-0.5 py-0.5">
                      <input
                        value={f.contra}
                        onChange={(e) => {
                          setFila(i, { contra: e.target.value });
                          setGuardado(false);
                        }}
                        placeholder="ej. 4,6,"
                        className={cellInput}
                      />
                    </td>
                    <td className="border border-emerald-100 px-0.5 py-0.5 text-center">
                      <button
                        type="button"
                        onClick={() => quitarFila(i)}
                        title="Quitar fila"
                        className="text-xs text-slate-400 transition-colors hover:text-red-500"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-emerald-100 bg-emerald-50 px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={agregarFila}
            className="text-emerald-700 hover:bg-emerald-100"
          >
            + Añadir carrera
          </Button>
          <span className="text-[10px] font-semibold text-slate-400">
            {filas.length} carrera(s) · {hipodromo || "sin hipódromo"} · {fecha}
          </span>
        </div>
      </div>

      {/* Condiciones editables */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-extrabold uppercase tracking-wider text-emerald-700">
            📜 Condiciones editables
          </label>
          <span className="text-[10px] text-slate-400">14ª prueba · válido según orden oficial</span>
        </div>
        <textarea
          value={condiciones}
          onChange={(e) => {
            setCondiciones(e.target.value);
            setGuardado(false);
          }}
          rows={4}
          className="w-full resize-y rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs font-medium leading-relaxed text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        />
      </div>

      {/* Simulador 120/100 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2 shadow-sm">
        <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700">
          🧮 Simulador 120/100
        </span>
        <select
          value={simRow}
          onChange={(e) => setSimRow(e.target.value)}
          className="rounded-lg border border-emerald-200 px-1.5 py-1 text-[11px] font-bold text-slate-900"
        >
          {filas.map((f, i) => (
            <option key={i} value={i + 1}>
              Carrera {Number(f.carrera) || f.carrera || i + 1}
            </option>
          ))}
        </select>
        <input
          value={simGanador}
          onChange={(e) => setSimGanador(e.target.value)}
          placeholder="Gana el Nº…"
          className="w-28 rounded-lg border border-emerald-200 px-1.5 py-1 text-[11px] font-bold text-slate-900"
        />
        <Button variant="success" size="sm" onClick={simular}>
          Simular pago
        </Button>
        {simRes && <span className="ml-auto text-xs font-bold text-slate-700">{simRes}</span>}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2">
        <Button variant="success" size="md" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "💾 Guardar día"}
        </Button>
        <Button variant="outline" size="md" onClick={generarReporte}>
          📤 Generar Reporte
        </Button>
        {guardado && (
          <span className="text-[11px] font-semibold text-emerald-600">
            ✓ Jornada de {hipodromo} · {fecha} guardada en Supabase
          </span>
        )}
      </div>

      {/* Modal de reporte */}
      {reporte !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setReporte(null)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-emerald-700 px-4 py-2.5 text-white">
              <h3 className="text-sm font-extrabold uppercase tracking-wide">📤 Reporte de Marcas</h3>
              <button type="button" onClick={() => setReporte(null)} className="text-lg leading-none hover:text-emerald-200">
                ✕
              </button>
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-800">
              {reporte}
            </pre>
            <div className="flex items-center gap-2 border-t border-emerald-100 px-4 py-3">
              <Button variant="success" size="sm" onClick={copiarReporte}>
                📋 Copiar
              </Button>
              <Button variant="outline" size="sm" onClick={enviarWhatsApp}>
                💬 WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarcasModule;