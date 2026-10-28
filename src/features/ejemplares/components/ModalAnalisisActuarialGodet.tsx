"use client";

import { useMemo, useState } from "react";
import { HorseSaddleclothSvg } from "@/shared/components/ui/HorseSaddleclothSvg";
import { CamisaJockeySvg } from "@/features/inteligencia/components/CamisaJockeySvg";
import { SimuladorPistaCarrera2D } from "@/features/inteligencia/components/SimuladorPistaCarrera2D";
import type { ResultadoCarreraV4, EstiloCarrera } from "@/features/inteligencia/lib/analista-venezuela-v4";
import {
  generarProspectivaGodet,
  type EjemplarGodet,
  type ModoAnalisis,
  type PistaEnVivo,
} from "@/features/gaceta/lib/actuarialGodetEngine";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  ejemplares: Array<Omit<Partial<EjemplarGodet>, "numero"> & { numero: number | string; nombre: string; stud?: string }>;
  hipodromo?: string;
  carrera?: number | string;
  fecha?: string;
  onImportarEjemplaresGaceta?: (nuevos: Array<{ numero: number; nombre: string }>) => void;
  onAbrirImportadorPdf?: () => void;
};

export function ModalAnalisisActuarialGodet({
  abierto,
  onCerrar,
  ejemplares,
  hipodromo,
  carrera,
  fecha,
  onImportarEjemplaresGaceta,
  onAbrirImportadorPdf,
}: Props) {
  const [modo, setModo] = useState<ModoAnalisis>("previa");
  const [pesosHoy, setPesosHoy] = useState<Record<string, string>>({});
  const [pista, setPista] = useState<PistaEnVivo>({
    sesgoRielInterno: 0,
    sesgoRielExterno: 0,
    sesgoVelocistas: 0,
    sesgoRematadores: 0,
    brisaRecta: 0,
    varianteObservada: 0,
  });
  const [tab, setTab] = useState<"simulacion" | "pizarra" | "mactor" | "smic" | "micmac" | "actuarial" | "parciales" | "gaceta">(
    "simulacion"
  );
  const [textoGacetaImport, setTextoGacetaImport] = useState("");
  const [ejemplaresImportadosLocal, setEjemplaresImportadosLocal] = useState<
    Array<Partial<EjemplarGodet> & { numero: number; nombre: string; stud?: string }>
  >([]);

  const baseEjemplares = ejemplaresImportadosLocal.length > 0 ? ejemplaresImportadosLocal : ejemplares;

  const lista = useMemo<EjemplarGodet[]>(
    () =>
      baseEjemplares.map((e, idx) => {
        const num = Number(String(e.numero).replace(/[^0-9]/g, "")) || idx + 1;
        return {
          id: String(e.id || num || idx),
          numero: num,
          nombre: e.nombre || `EJEMPLAR ${num}`,
          stud: e.stud,
          tipoCarrera: e.tipoCarrera ?? (num % 3 === 0 ? "rematador" : num % 2 === 0 ? "perseguidor" : "velocista"),
          actuaciones: e.actuaciones ?? 6 + (num % 5),
          varianzaTTC: e.varianzaTTC ?? 0.12 + (num % 4) * 0.05,
          speedRatingTTC: e.speedRatingTTC ?? 72 + (num % 6) * 2,
          efectividadYunta: e.efectividadYunta ?? 0.45 + (num % 4) * 0.08,
          diasDescanso: e.diasDescanso ?? 18 + (num % 10),
          kilosHandicap: e.kilosHandicap ?? 54 + (num % 4),
          pesoOptimoGanadorKg: e.pesoOptimoGanadorKg ?? 480 + (num % 6),
          pesoFisicoHoyKg: pesosHoy[String(num)] ? Number(pesosHoy[String(num)]) : e.pesoFisicoHoyKg,
          alertasMedicas: e.alertasMedicas ?? [],
        };
      }),
    [baseEjemplares, pesosHoy]
  );

  const res = useMemo(
    () =>
      generarProspectivaGodet(
        lista,
        modo,
        {
          pista: "arena",
          clima: "seco",
          cambioJockey: false,
          cambioEntrenador: false,
          reaparecida: false,
          customFactors: [],
        },
        modo === "en_vivo" ? pista : undefined
      ),
    [lista, modo, pista]
  );

  const resultadoV4ParaSimulacion = useMemo<ResultadoCarreraV4>(() => {
    const rankingV4 = res.ordenLlegada.map((r, idx) => ({
      ejemplar: {
        id: String(r.ejemplar.id || r.ejemplar.numero),
        numero: r.ejemplar.numero,
        nombre: r.ejemplar.nombre,
        puestoPista: r.ejemplar.numero,
        jinete: "Jinete Oficial",
        kilos: r.ejemplar.kilosHandicap ?? 54,
        entrenador: "Entrenador Oficial",
        stud: r.ejemplar.stud,
        divisaTexto: r.ejemplar.stud,
        morningLine: 2.0 + idx * 0.8,
        speedRatingTTC: r.ejemplar.speedRatingTTC ?? 75,
        varianzaTTC: r.ejemplar.varianzaTTC ?? 0.15,
        estilo: (r.ejemplar.tipoCarrera === "rematador"
          ? "E3"
          : r.ejemplar.tipoCarrera === "perseguidor"
          ? "E2"
          : "E1") as EstiloCarrera,
        actuacionesPrevias: r.ejemplar.actuaciones ?? 5,
        diasSinCorrer: r.ejemplar.diasDescanso ?? 21,
        pesoOptimoKg: r.ejemplar.pesoOptimoGanadorKg || 450,
        pesoHoyKg: r.ejemplar.pesoFisicoHoyKg,
        efectividadJineteEntrenador: r.ejemplar.efectividadYunta ?? 0.45,
        tendenciaTramoFinal: (r.ejemplar.tipoCarrera === "rematador" ? "ATROPELLA" : "SE_MANTIENE") as "ATROPELLA" | "SE_MANTIENE",
        lineaPistaEstimada: (r.ejemplar.numero <= 3 ? "RIEL" : r.ejemplar.numero >= 7 ? "AFUERA" : "CENTRO") as "RIEL" | "AFUERA" | "CENTRO",
      },
      ordenLlegadaProyectado: r.puestoProyectado,
      scoreGodetTotal: r.score,
      probabilidadSMIC: r.probNorm,
      cuerposVentaja: idx === 0 ? 0 : idx * 1.5,
      favorecidoTendenciaTarde: false,
      bonoPesoOptimo: false,
      alertaPeso: false,
      deltaPesoKg: null,
      esLinea5y6: idx === 0 && r.probNorm >= 38,
      esMorocha5y6: idx <= 1,
      esSorpresaOverlay: false,
      badges: [],
      detallesFactores: {},
    }));

    return {
      carreraNumero: Number(carrera ?? 1),
      hipodromo: hipodromo || "LA RINCONADA",
      distancia: 1200,
      fecha: fecha || new Date().toISOString().split("T")[0],
      esValida5y6: false,
      escenarioDominanteSMIC: {
        codigo: "E_DOMINANTE",
        titulo: res.smic?.escenarioDominante?.titulo || "Escenario Base",
        descripcion: res.smic?.escenarioDominante?.descripcion || "Proyección estándar",
        probabilidadPct: res.smic?.escenarioDominante?.probabilidadPct || 50,
      },
      tendenciaTardeAplicada: false,
      ranking: rankingV4,
    };
  }, [carrera, hipodromo, fecha, res.ordenLlegada, res.smic?.escenarioDominante]);

  if (!abierto) return null;

  const procesarImportacionGaceta = () => {
    const lineas = textoGacetaImport
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const parseados: Array<{ numero: number; nombre: string; speedRatingTTC?: number }> = [];
    for (const l of lineas) {
      const m = /^#?(\d{1,2})[\s.)\-:]+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9' ]+?)(?:\s+(\d{2,3}))?$/.exec(l);
      if (m) {
        parseados.push({
          numero: Number(m[1]),
          nombre: m[2].trim().toUpperCase(),
          speedRatingTTC: m[3] ? Number(m[3]) : undefined,
        });
      }
    }
    if (parseados.length > 0) {
      setEjemplaresImportadosLocal(parseados);
      onImportarEjemplaresGaceta?.(parseados.map((p) => ({ numero: p.numero, nombre: p.nombre })));
      setTab("pizarra");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-amber-400/30 bg-slate-950 text-slate-100 shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.22em] text-amber-400">
              🧭 Motor Hípico Godet IA v3 (MACTOR + SMIC + Actuario v4)
            </h2>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              {hipodromo ? `${hipodromo} · Carrera ${carrera ?? 1}${fecha ? ` · ${fecha}` : ""} · ` : ""}
              MICMAC · MACTOR · SMIC Prob-Expert · Bühlmann-Straub · Cox · Kelly Fraccional
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onAbrirImportadorPdf && (
              <button
                type="button"
                onClick={onAbrirImportadorPdf}
                className="rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-3 py-1 text-[10px] font-black uppercase text-slate-950 shadow-sm hover:from-amber-400 hover:to-yellow-300 flex items-center gap-1.5 transition-all"
              >
                <span>📄</span>
                <span>Importar Gaceta PDF con IA</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setModo("previa")}
              className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${
                modo === "previa" ? "bg-amber-400 text-slate-900" : "bg-slate-800 text-slate-300"
              }`}
            >
              Modo Previa (Gaceta)
            </button>
            <button
              type="button"
              onClick={() => setModo("en_vivo")}
              className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${
                modo === "en_vivo" ? "bg-emerald-400 text-slate-900" : "bg-slate-800 text-slate-300"
              }`}
            >
              Modo En Vivo (Pista)
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300 hover:bg-red-500/20"
            >
              ✕ Cerrar
            </button>
          </div>
        </header>

        <nav className="flex flex-wrap gap-1.5 border-b border-slate-800 bg-slate-900/60 px-6 py-2">
          {(
            [
              ["simulacion", "🏇 Pista & Simulación 2D"],
              ["pizarra", "🏁 Pizarra Prospectiva"],
              ["mactor", "♟️ MACTOR (Actores E1/E2/E3)"],
              ["smic", "🎲 SMIC (Escenarios Cruzados)"],
              ["actuarial", "📐 Actuario v4 (Bühlmann / Cox / Kelly)"],
              ["parciales", "⏱️ Parciales 400m & Remate"],
              ["micmac", "🕸️ MICMAC Estructural"],
              ["gaceta", "📥 Importar Gaceta / Carrera"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase transition ${
                tab === t ? "bg-amber-400 text-slate-950" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto px-6 py-4">
          {tab === "simulacion" && (
            <div className="space-y-4">
              <SimuladorPistaCarrera2D
                resultado={resultadoV4ParaSimulacion}
                factorPistaActual={pista.varianteObservada < -0.3 ? "LIGERA" : pista.varianteObservada > 0.6 ? "PESADA" : "NORMAL"}
                carrilActual={pista.sesgoRielInterno > 0 ? "RIEL" : pista.sesgoRielExterno > 0 ? "AFUERA" : "CENTRO"}
                estiloActual={pista.sesgoVelocistas > 0 ? "E1" : pista.sesgoRematadores > 0 ? "E3" : "E2"}
              />
            </div>
          )}

          {tab === "pizarra" && (
            <div className="space-y-4">
              {res.smic?.escenarioDominante && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs">
                  <span className="font-black uppercase text-amber-300">
                    🎯 Escenario SMIC Dominante ({res.smic.escenarioDominante.probabilidadPct}%):{" "}
                  </span>
                  <span className="font-bold text-white">{res.smic.escenarioDominante.titulo}</span>
                  <span className="ml-2 text-slate-300">— {res.smic.escenarioDominante.descripcion}</span>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-amber-400/30 text-[9px] uppercase tracking-[0.2em] text-amber-300">
                      <th className="px-3 py-2">Puesto</th>
                      <th className="px-3 py-2">N°</th>
                      <th className="px-3 py-2">Ejemplar</th>
                      <th className="px-3 py-2">Rol MACTOR</th>
                      <th className="px-3 py-2">Peso Óptimo</th>
                      <th className="px-3 py-2">Peso Hoy (Kg)</th>
                      <th className="px-3 py-2">Prob. Norm.</th>
                      <th className="px-3 py-2">Score / Kelly</th>
                      <th className="px-3 py-2">Remate 200m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.ordenLlegada.map((row) => (
                      <tr key={row.ejemplar.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-black text-amber-300">#{row.puestoProyectado}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <CamisaJockeySvg
                              numero={row.ejemplar.numero}
                              divisaTexto={row.ejemplar.stud}
                              size={28}
                              mostrarGualdrapa={true}
                              permitirEdicionIa={true}
                            />
                            <span className="font-black">{row.ejemplar.numero}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-bold text-white">{row.ejemplar.nombre}</td>
                        <td className="px-3 py-2 text-[10px] font-bold uppercase text-cyan-300">
                          {row.ejemplar.tipoCarrera}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{row.ejemplar.pesoOptimoGanadorKg || "-"} kg</td>
                        <td className="px-3 py-2">
                          <input
                            value={pesosHoy[String(row.ejemplar.numero)] || ""}
                            onChange={(e) =>
                              setPesosHoy((p) => ({ ...p, [String(row.ejemplar.numero)]: e.target.value }))
                            }
                            placeholder="--"
                            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-center text-white"
                          />
                        </td>
                        <td className="px-3 py-2 font-black text-emerald-400">{row.probNorm}%</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                            S:{row.score.toFixed(1)} · K:{((row.kelly?.kellyFraccional ?? 0) * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold text-amber-200">{row.remate.ultima200Seg}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {modo === "en_vivo" && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 md:grid-cols-6">
                  {Object.entries(pista).map(([k, v]) => (
                    <label key={k} className="flex flex-col gap-1 text-[10px] uppercase text-slate-400">
                      <span>{k}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={v}
                        onChange={(e) => setPista((p) => ({ ...p, [k]: Number(e.target.value) }))}
                        className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "mactor" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                  <p className="text-[10px] font-black uppercase text-rose-300">E1 · Velocistas / Punteros</p>
                  <p className="mt-1 text-2xl font-black text-white">
                    {res.mactor.grupos.E1} ({res.mactor.equilibrio.E1}%)
                  </p>
                </div>
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                  <p className="text-[10px] font-black uppercase text-cyan-300">E2 · Perseguidores / Stalkers</p>
                  <p className="mt-1 text-2xl font-black text-white">
                    {res.mactor.grupos.E2} ({res.mactor.equilibrio.E2}%)
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-[10px] font-black uppercase text-emerald-300">E3 · Rematadores / Fondistas</p>
                  <p className="mt-1 text-2xl font-black text-white">
                    {res.mactor.grupos.E3} ({res.mactor.equilibrio.E3}%)
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <h4 className="mb-2 text-xs font-black uppercase text-amber-300">
                  Matriz de Convergencias y Divergencias MACTOR
                </h4>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(res.mactor.actores ?? []).map((a) => (
                    <div
                      key={a.numero}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                    >
                      <span className="font-bold text-white">
                        #{a.numero} {a.nombre}
                      </span>
                      <span className="text-[10px] font-black uppercase text-amber-300">
                        {a.rol} · Fuerza {a.fuerzaRelativa}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "smic" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(res.smic?.escenarios ?? []).map((esc) => (
                <div
                  key={esc.codigo}
                  className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-4"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-amber-300">{esc.titulo}</span>
                      <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-black text-slate-950">
                        {esc.probabilidadPct}%
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">{esc.descripcion}</p>
                  </div>
                  <div className="mt-4 border-t border-slate-800 pt-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Ejemplares favorecidos:</p>
                    <p className="mt-1 text-xs font-bold text-emerald-300">
                      {esc.beneficiados.join(" · ") || "Sin ejemplares"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "micmac" && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <pre className="overflow-x-auto text-[11px] text-emerald-300">{JSON.stringify(res.micmac, null, 2)}</pre>
            </div>
          )}

          {tab === "actuarial" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {res.ordenLlegada.map((row) => (
                <div key={row.ejemplar.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <HorseSaddleclothSvg numero={row.ejemplar.numero} size={28} />
                    <span className="font-black">
                      #{row.ejemplar.numero} {row.ejemplar.nombre}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>Bühlmann Z: <b className="text-amber-300">{row.credibilidad.Z}</b></div>
                    <div>Speed ajustado: <b className="text-emerald-300">{row.credibilidad.speedAjustado}</b></div>
                    <div>Hazard Ratio Cox: <b className="text-cyan-300">{row.riesgo.hazardRatio}</b></div>
                    <div>Riesgo Fatiga: <b className="uppercase text-white">{row.riesgo.riesgo}</b></div>
                    <div>Kelly Fraccional: <b className="text-amber-300">{((row.kelly?.kellyFraccional ?? 0) * 100).toFixed(1)}%</b></div>
                    <div>EV Estimado: <b className="text-emerald-300">{row.kelly?.ev ?? 0}</b></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "parciales" && (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-amber-400/40 text-[9px] uppercase tracking-[0.24em] text-amber-300">
                    <th className="px-4 py-2">N°</th>
                    <th className="px-4 py-2">400m</th>
                    <th className="px-4 py-2">800m</th>
                    <th className="px-4 py-2">1200m</th>
                    <th className="px-4 py-2">1600m</th>
                    <th className="px-4 py-2">Remate Final 200m</th>
                  </tr>
                </thead>
                <tbody>
                  {res.ordenLlegada.map((row) => (
                    <tr key={row.ejemplar.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <HorseSaddleclothSvg numero={row.ejemplar.numero} size={26} />
                          <span className="font-black">
                            {row.ejemplar.numero} · {row.ejemplar.nombre}
                          </span>
                        </div>
                      </td>
                      {row.parciales.map((p) => (
                        <td key={p.tramo} className="px-4 py-2 tabular-nums">
                          {p.tiempoSeg}s · {p.velocidadMS} m/s
                        </td>
                      ))}
                      <td className="px-4 py-2 font-bold text-amber-300 tabular-nums">{row.remate.ultima200Seg}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "gaceta" && (
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              {onAbrirImportadorPdf && (
                <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-indigo-500/15 p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500 text-slate-950 font-black text-xl shadow-xs">
                      📄
                    </span>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">
                        Extracción Inteligente de Gaceta Hípica (PDF / Imagen)
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        Sube el archivo PDF oficial para que la IA transcriba y proyecte automáticamente todos los factores de la reunión.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onAbrirImportadorPdf}
                    className="rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-2 text-xs font-black uppercase text-slate-950 shadow-md hover:from-amber-400 hover:to-yellow-300 transition-all flex items-center gap-2"
                  >
                    <span>🚀</span>
                    <span>Abrir Extractor de Gaceta PDF con IA</span>
                  </button>
                </div>
              )}

              <p className="text-xs font-bold text-amber-300">
                📥 Importación rápida de ejemplares desde Gaceta / Retrospecto para {hipodromo || "el hipódromo activo"} C{carrera || 1}
              </p>
              <p className="text-[11px] text-slate-400">
                Pegue una línea por ejemplar (formato: <code>1 RELAMPAGO 84</code> o <code>1 - RELAMPAGO</code>). Se recalcularán de inmediato MACTOR, SMIC y Actuario v4.
              </p>
              <textarea
                value={textoGacetaImport}
                onChange={(e) => setTextoGacetaImport(e.target.value)}
                rows={7}
                placeholder={"1 RELAMPAGO 84\n2 HURACAN 79\n3 CENTELLA 88\n4 TRUENO 76"}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white"
              />
              <div className="flex justify-end gap-2">
                {ejemplaresImportadosLocal.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEjemplaresImportadosLocal([])}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300"
                  >
                    Restaurar padrón de la carrera
                  </button>
                )}
                <button
                  type="button"
                  onClick={procesarImportacionGaceta}
                  className="rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-black uppercase text-slate-950 hover:bg-amber-300"
                >
                  ⚡ Procesar en Motor Godet v3
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModalAnalisisActuarialGodet;
