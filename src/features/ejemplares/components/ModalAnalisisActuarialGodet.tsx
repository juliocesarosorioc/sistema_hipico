"use client";

import { useMemo, useState } from "react";
import { HorseSaddleclothSvg } from "@/shared/components/ui/HorseSaddleclothSvg";
import { generarProspectivaGodet, type EjemplarGodet, type ModoAnalisis, type PistaEnVivo } from "@/features/gaceta/lib/actuarialGodetEngine";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  ejemplares: Array<Partial<EjemplarGodet> & { numero: number; nombre: string; stud?: string }>;
};

export function ModalAnalisisActuarialGodet({ abierto, onCerrar, ejemplares }: Props) {
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
  const [tab, setTab] = useState<"pizarra" | "micmac" | "mactor" | "actuarial" | "parciales">("pizarra");

  const lista = useMemo<EjemplarGodet[]>(
    () =>
      ejemplares.map((e, idx) => ({
        id: String(e.id || idx),
        numero: e.numero,
        nombre: e.nombre,
        stud: e.stud,
        tipoCarrera: e.numero % 3 === 0 ? "rematador" : e.numero % 2 === 0 ? "perseguidor" : "velocista",
        actuaciones: 6 + (e.numero % 5),
        varianzaTTC: 0.12 + (e.numero % 4) * 0.05,
        speedRatingTTC: 72 + (e.numero % 6) * 2,
        efectividadYunta: 0.45 + (e.numero % 4) * 0.08,
        diasDescanso: 18 + (e.numero % 10),
        kilosHandicap: 54 + (e.numero % 4),
        pesoOptimoGanadorKg: 480 + (e.numero % 6),
        pesoFisicoHoyKg: pesosHoy[String(e.numero)] ? Number(pesosHoy[String(e.numero)]) : undefined,
        alertasMedicas: [],
      })),
    [ejemplares, pesosHoy]
  );

  const res = useMemo(
    () =>
      generarProspectivaGodet(
        lista,
        modo,
        { pista: "arena", clima: "seco", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] },
        modo === "en_vivo" ? pista : undefined
      ),
    [lista, modo, pista]
  );

  if (!abierto) return null;

  return (
    <div className="sh-godet-modal-backdrop">
      <div className="sh-godet-modal-container">
        <header className="flex items-center justify-between border-b border-slate-700/70 px-6 py-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.32em] text-amber-400">🧭 Pizarra Prospectiva Godet & Actuarial</h2>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">MICMAC · MACTOR · Bühlmann-Straub · Cox · Kelly Fraccional · Parciales 400m</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setModo("previa")} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${modo === "previa" ? "bg-amber-400 text-slate-900" : "bg-slate-800 text-slate-300"}`}>
              Modo Previa (Gaceta)
            </button>
            <button onClick={() => setModo("en_vivo")} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${modo === "en_vivo" ? "bg-emerald-400 text-slate-900" : "bg-slate-800 text-slate-300"}`}>
              Modo En Vivo (Opcional)
            </button>
            <button onClick={onCerrar} className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800">
              Cerrar
            </button>
          </div>
        </header>

        <nav className="flex gap-2 border-b border-slate-700/70 px-6 py-2">
          {(["pizarra", "micmac", "mactor", "actuarial", "parciales"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${tab === t ? "bg-slate-700 text-white" : "text-slate-400"}`}>
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto px-6 py-4">
          {tab === "pizarra" && (
            <div className="space-y-4">
              <div className="sh-pizarra-led overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-amber-400/40 text-[9px] uppercase tracking-[0.24em] text-amber-300">
                      <th className="px-4 py-2">Puesto</th>
                      <th className="px-4 py-2">N°</th>
                      <th className="px-4 py-2">Ejemplar</th>
                      <th className="px-4 py-2">Stud</th>
                      <th className="px-4 py-2">Peso Óptimo</th>
                      <th className="px-4 py-2">Peso Hoy (Kg)</th>
                      <th className="px-4 py-2">Prob. Norm.</th>
                      <th className="px-4 py-2">EV/Kelly</th>
                      <th className="px-4 py-2">Remate 200m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.ordenLlegada.map((row) => (
                      <tr key={row.ejemplar.id} className="border-b border-slate-800/60">
                        <td className="px-4 py-2 text-amber-300">#{row.puestoProyectado}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <HorseSaddleclothSvg numero={row.ejemplar.numero} studColor="#f59e0b" size={34} />
                            <span className="font-black">{row.ejemplar.numero}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 font-semibold">{row.ejemplar.nombre}</td>
                        <td className="px-4 py-2 text-slate-400">{row.ejemplar.stud || "-"}</td>
                        <td className="px-4 py-2">{row.ejemplar.pesoOptimoGanadorKg || "-"} kg</td>
                        <td className="px-4 py-2">
                          <input
                            value={pesosHoy[String(row.ejemplar.numero)] || ""}
                            onChange={(e) => setPesosHoy((p) => ({ ...p, [String(row.ejemplar.numero)]: e.target.value }))}
                            placeholder="--"
                            className="w-20 rounded bg-slate-900/80 px-2 py-1 text-center"
                          />
                        </td>
                        <td className="px-4 py-2 text-emerald-400">{row.probNorm}%</td>
                        <td className="px-4 py-2">
                          <span className={row.score > 80 ? "sh-actuarial-badge-positive" : row.score > 70 ? "sh-actuarial-badge-warning" : "sh-actuarial-badge-danger"}>
                            S:{row.score.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-4 py-2">{row.remate.ultima200Seg}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {modo === "en_vivo" && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                  {Object.entries(pista).map(([k, v]) => (
                    <label key={k} className="flex flex-col gap-1 text-[10px] uppercase text-slate-400">
                      <span>{k}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={v}
                        onChange={(e) => setPista((p) => ({ ...p, [k]: Number(e.target.value) }))}
                        className="rounded bg-slate-900/80 px-2 py-1 text-slate-200"
                      />
                    </label>
                  ))}
                </div>
              )}
              <div className="sh-track-surface h-24 w-full" />
            </div>
          )}

          {tab === "micmac" && (
            <div className="sh-pizarra-led p-4">
              <pre className="overflow-x-auto text-[10px] text-emerald-300">{JSON.stringify(res.micmac, null, 2)}</pre>
            </div>
          )}
          {tab === "mactor" && (
            <div className="sh-pizarra-led p-4">
              <pre className="overflow-x-auto text-[10px] text-amber-300">{JSON.stringify(res.mactor, null, 2)}</pre>
            </div>
          )}
          {tab === "actuarial" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {res.ordenLlegada.map((row) => (
                <div key={row.ejemplar.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <HorseSaddleclothSvg numero={row.ejemplar.numero} size={28} />
                    <span className="font-black">#{row.ejemplar.numero} {row.ejemplar.nombre}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>Bühlmann Z: {row.credibilidad.Z}</div>
                    <div>Speed ajustado: {row.credibilidad.speedAjustado}</div>
                    <div>Hazard Ratio: {row.riesgo.hazardRatio}</div>
                    <div>Riesgo: {row.riesgo.riesgo}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "parciales" && (
            <div className="sh-pizarra-led overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-amber-400/40 text-[9px] uppercase tracking-[0.24em] text-amber-300">
                    <th className="px-4 py-2">N°</th>
                    <th className="px-4 py-2">400m</th>
                    <th className="px-4 py-2">800m</th>
                    <th className="px-4 py-2">1200m</th>
                    <th className="px-4 py-2">1600m</th>
                    <th className="px-4 py-2">Remate Final</th>
                  </tr>
                </thead>
                <tbody>
                  {res.ordenLlegada.map((row) => (
                    <tr key={row.ejemplar.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <HorseSaddleclothSvg numero={row.ejemplar.numero} size={26} />
                          <span className="font-black">{row.ejemplar.numero}</span>
                        </div>
                      </td>
                      {row.parciales.map((p) => (
                        <td key={p.tramo} className="px-4 py-2 tabular-nums">
                          {p.tiempoSeg}s · {p.velocidadMS} m/s
                        </td>
                      ))}
                      <td className="px-4 py-2 tabular-nums">{row.remate.ultima200Seg}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModalAnalisisActuarialGodet;
