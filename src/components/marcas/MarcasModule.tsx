"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { ChipField } from "@/components/ui/HorseChips";
import { listarHipodromos, listarCarrerasPorDia, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { hoyLocal } from "@/lib/gaceta/programa";
import {
  CONDICIONES_MARCAS_DEFECTO,
  guardarMarcas,
  leerMarcas,
  type FilaMarca,
} from "@/lib/marcas";
import { liquidarMarcas, parsearMarcasLista } from "@/lib/motores/marcas";
import type { TicketMotor } from "@/lib/bettingEngine";
import { VentaMarcasModal } from "./VentaMarcasModal";

// =========================================================
// NUEVA UTILIDAD: Cuadritos de colores hípicos oficiales
// =========================================================
const getCaballoColor = (numero: string | number) => {
  const num = parseInt(String(numero), 10);
  const colores: Record<number, { bg: string, text: string }> = {
    1: { bg: "bg-red-600", text: "text-white" },
    2: { bg: "bg-white border-2 border-gray-300", text: "text-black" },
    3: { bg: "bg-blue-600", text: "text-white" },
    4: { bg: "bg-yellow-400", text: "text-black" },
    5: { bg: "bg-green-600", text: "text-white" },
    6: { bg: "bg-black", text: "text-white" },
    7: { bg: "bg-orange-500", text: "text-white" },
    8: { bg: "bg-pink-400", text: "text-black" },
    9: { bg: "bg-cyan-400", text: "text-black" },
    10: { bg: "bg-purple-600", text: "text-white" },
    11: { bg: "bg-gray-400", text: "text-black" },
    12: { bg: "bg-lime-400", text: "text-black" },
    13: { bg: "bg-amber-800", text: "text-white" },
    14: { bg: "bg-red-900", text: "text-white" },
  };
  return colores[num] || { bg: "bg-slate-200 border border-slate-400", text: "text-slate-800" };
};

// Extrae números de un string ej: "2/3/7" -> [2, 3, 7] para pintar los cuadritos
const extraerNumeros = (str: string) => {
  return str.split(/[\/, -]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
};

export function MarcasModule() {
  const [hipodromos, setHipodromos] = useState<OpcionHipodromo[]>([]);
  const [hipodromo, setHipodromo] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());

  const [filas, setFilas] = useState<FilaMarca[]>([]);
  const [carrerasDia, setCarrerasDia] = useState<number[]>([]);
  const [condiciones, setCondiciones] = useState<string>(CONDICIONES_MARCAS_DEFECTO);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const [reporte, setReporte] = useState<string | null>(null);

  const [simRow, setSimRow] = useState("1");
  const [simGanador, setSimGanador] = useState("");
  const [simRes, setSimRes] = useState<string | null>(null);
  const [vendiendoMarca, setVendiendoMarca] = useState<FilaMarca | null>(null);
  
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
      const carr = await listarCarrerasPorDia(fecha, hipodromo);
      if (v) setCarrerasDia(carr);
      const r = await leerMarcas(hipodromo, fecha);
      if (!v) return;
      if (r.ok && r.datos && r.datos.filas.length) {
        setFilas(r.datos.filas);
        setCondiciones(r.datos.condiciones || CONDICIONES_MARCAS_DEFECTO);
        setGuardado(true);
      } else {
        setFilas(
          carr.length
            ? carr.map((n) => ({ carrera: String(n), marcadas: "", contra: "" }))
            : []
        );
        setCondiciones(CONDICIONES_MARCAS_DEFECTO);
        setGuardado(false);
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
      const usadas = new Set(fs.map((f) => Number(f.carrera) || 0));
      const prox = carrerasDia.find((n) => !usadas.has(n));
      if (prox != null) return [...fs, { carrera: String(prox), marcadas: "", contra: "" }];
      const max = fs.reduce((a, f) => Math.max(a, Number(f.carrera) || 0), 0);
      return [...fs, { carrera: String(max + 1), marcadas: "", contra: "" }];
    });

  const quitarFila = (i: number) => setFilas((fs) => fs.filter((_, k) => k !== i));

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
        `${String(f.carrera || "?").padEnd(3)}  MARCAS: ${f.marcadas.trim() || "—"}  NV  CONTRA: ${f.contra.trim() || "—"}`
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
    
    // CORRECCIÓN MATEMÁTICA AQUÍ (Faltaba el asterisco *)
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

      {/* Tabla diaria — grilla densa estilo Excel */}
      <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr className="bg-emerald-600 text-emerald-50">
                <th className="w-10 shrink-0 border border-emerald-700 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
                  Nº
                </th>
                <th className="border border-emerald-700 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
                  Marcas <span className="text-emerald-300">( / )</span>
                </th>
                <th className="w-9 shrink-0 border border-emerald-700 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
                  Ley
                </th>
                <th className="border border-emerald-700 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
                  Contra <span className="text-emerald-300">( , )</span>
                </th>
                <th className="w-8 shrink-0 border border-emerald-700 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
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
              {!cargando && filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-xs font-semibold text-amber-600">
                    ⚠️ No hay carreras registradas para {hipodromo || "este hipódromo"} · {fecha}.{" "}
                    <span className="block text-slate-500">
                      Registre primero las carreras del día (Programa / Tablas / Resultados) o pulse
                      "+ Añadir carrera".
                    </span>
                  </td>
                </tr>
              )}
              {!cargando &&
                filas.map((f, i) => (
                  <tr
                    key={i}
                    className={i % 2 ? "bg-emerald-50/60" : "bg-white"}
                  >
                    <td className="shrink-0 border border-emerald-100 px-0.5 py-0 text-center align-middle text-xs font-extrabold text-emerald-700">
                      {Number(f.carrera) || f.carrera}
                    </td>
                    
                    {/* COLUMNA MARCAS - Con Cuadritos de colores inyectados */}
                    <td className="border border-emerald-100 p-1.5 align-middle">
                      <ChipField
                        value={f.marcadas}
                        onChange={(v) => {
                          setFila(i, { marcadas: v });
                          setGuardado(false);
                        }}
                        placeholder="ej. 2/3/7/1/5"
                      />
                      {/* Los colores hípicos aparecen aquí abajo solos mientras el usuario tipea */}
                      {f.marcadas && extraerNumeros(f.marcadas).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {extraerNumeros(f.marcadas).map((num, idx) => {
                            const c = getCaballoColor(num);
                            return (
                              <span key={idx} className={`w-5 h-5 flex items-center justify-center rounded-sm text-[10px] font-black shadow-sm ${c.bg} ${c.text}`}>
                                {num}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>

                    <td className="shrink-0 border border-emerald-100 p-0 text-center align-middle">
                      <span className="inline-block leading-none text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
                        NV
                      </span>
                    </td>

                    {/* COLUMNA CONTRA - Con Cuadritos de colores inyectados */}
                    <td className="border border-emerald-100 p-1.5 align-middle">
                      <ChipField
                        value={f.contra}
                        onChange={(v) => {
                          setFila(i, { contra: v });
                          setGuardado(false);
                        }}
                        placeholder="ej. 4,6,"
                      />
                       {f.contra && extraerNumeros(f.contra).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {extraerNumeros(f.contra).map((num, idx) => {
                            const c = getCaballoColor(num);
                            return (
                              <span key={idx} className={`w-5 h-5 flex items-center justify-center rounded-sm text-[10px] font-black shadow-sm ${c.bg} ${c.text}`}>
                                {num}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>

                    <td className="shrink-0 border border-emerald-100 p-1 text-center align-middle">
                      <div className="flex flex-col gap-1 items-center justify-center">
                        <button
                          type="button"
                          onClick={() => setVendiendoMarca(f)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm w-full transition-colors"
                        >
                           🎟️ Vender
                         </button>
                         <button
                          type="button"
                          onClick={() => quitarFila(i)}
                          title="Quitar fila"
                          className="text-[10px] text-slate-400 transition-colors hover:text-red-500 uppercase font-bold"
                        >
                          🗑️ Quitar
                        </button>
                      </div>
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
          {/* MODAL DE VENTA DE MARCAS */}
      {vendiendoMarca && (
        <VentaMarcasModal
          hipodromo={hipodromo}
          carrera={String(vendiendoMarca.carrera)}
          fecha={fecha}
          marcasIniciales={vendiendoMarca.marcadas}
          contraIniciales={vendiendoMarca.contra}
          onCerrar={() => setVendiendoMarca(null)}
        />
      )}
    </div>
    
  );
}

export default MarcasModule;