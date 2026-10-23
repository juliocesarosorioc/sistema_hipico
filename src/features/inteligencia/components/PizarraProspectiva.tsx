"use client";

import { useMemo, useState } from "react";
import { HorseSaddleclothSvg } from "@/shared/components/ui/HorseSaddleclothSvg";
import { Button } from "@/shared/components/ui/Button";
import type { ProyeccionCarrera } from "@/features/inteligencia/lib/datos";
import {
  AJUSTES_POR_DEFECTO,
  construirPizarra,
  rectaFinal,
  type AjustesPizarra,
  type EstiloCarrera,
  type FactorPista,
  type FilaPizarra,
  type InsumoPizarra,
  type SesgoPista,
} from "@/features/inteligencia/lib/pizarra";

type Props = {
  proyeccion: ProyeccionCarrera;
  fecha: string;
  /** Reconcilia los retiros de la pizarra con el servicio central de la carrera. */
  onAplicarRetiros: (numeros: number[]) => Promise<boolean>;
  /** `true` mientras el servicio central escribe. */
  aplicandoRetiros?: boolean;
};

const ESTILO_CHIP: Record<EstiloCarrera, { label: string; cls: string; detalle: string }> = {
  E1: {
    label: "E1",
    cls: "bg-sky-500/20 text-sky-200 border-sky-400/50",
    detalle: "Velocista: impone el ritmo",
  },
  E2: {
    label: "E2",
    cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/50",
    detalle: "Perseguidor: corre detrás de la punta",
  },
  E3: {
    label: "E3",
    cls: "bg-violet-500/20 text-violet-200 border-violet-400/50",
    detalle: "Rematador: llega desde atrás",
  },
};

const ETIQUETA_PISTA: Record<FactorPista, string> = {
  normal: "Normal (0.0 s)",
  ligera: "Ligera / rápida (−0.6 s)",
  pesada: "Pesada (+1.2 s)",
};

const ETIQUETA_SESGO: Record<SesgoPista, string> = {
  off: "Sin sesgo adicional (previa)",
  riel_interno: "Ganan por el riel interno (PP 1–3)",
  riel_externo: "Riel interno pesado (ganan 5+)",
  velocistas: "La pista favorece a los velocistas (E1)",
  rematadores: "Colapsan los punteros (ganan E2/E3)",
};

function inicialesPesos(proyeccion: ProyeccionCarrera): Record<number, string> {
  const salida: Record<number, string> = {};
  for (const [num, prog] of Object.entries(proyeccion.programacion)) {
    if (prog.pesoHoyKg != null) salida[Number(num)] = String(prog.pesoHoyKg);
  }
  return salida;
}

/** Números retirados según la lista CENTRAL de la carrera (los oficiales). */
function retiradosOficiales(proyeccion: ProyeccionCarrera): number[] {
  return proyeccion.insumosPizarra.filter((i) => i.retirado).map((i) => i.numero);
}

const mismoConjunto = (a: number[], b: number[]): boolean => {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const n of sa) if (!sb.has(n)) return false;
  return true;
};

export function PizarraProspectiva({ proyeccion, fecha, onAplicarRetiros, aplicandoRetiros = false }: Props) {
  const oficiales = useMemo(() => retiradosOficiales(proyeccion), [proyeccion]);
  const [retirados, setRetirados] = useState<number[]>(() => oficiales);
  const [pesos, setPesos] = useState<Record<number, string>>(() => inicialesPesos(proyeccion));
  const [ajustes, setAjustes] = useState<AjustesPizarra>(AJUSTES_POR_DEFECTO);

  // Si el módulo recarga la carrera (otra pestaña retiró un ejemplar), la
  // pizarra se sincroniza con la lista central vigente.
  const [huella, setHuella] = useState(() => `${proyeccion.carrera.carrera}|${oficiales.join(",")}`);
  const huellaActual = `${proyeccion.carrera.carrera}|${oficiales.join(",")}`;
  if (huella !== huellaActual) {
    setHuella(huellaActual);
    setRetirados(oficiales);
    setPesos(inicialesPesos(proyeccion));
  }

  const insumos: InsumoPizarra[] = useMemo(
    () =>
      proyeccion.insumosPizarra.map((i) => {
        const pesoTexto = pesos[i.numero];
        const peso = pesoTexto != null && pesoTexto !== "" ? Number(String(pesoTexto).replace(",", ".")) : null;
        return {
          ...i,
          retirado: retirados.includes(i.numero),
          pesoHoyKg: Number.isFinite(peso as number) ? (peso as number) : null,
        };
      }),
    [proyeccion.insumosPizarra, pesos, retirados]
  );

  const pizarra = useMemo(
    () => construirPizarra(insumos, ajustes, proyeccion.distancia || 1200),
    [insumos, ajustes, proyeccion.distancia]
  );
  const carriles = useMemo(() => rectaFinal(pizarra.activos, 6), [pizarra]);

  const hayCambios = !mismoConjunto(retirados, oficiales);
  const conPesos = Object.keys(pesos).length > 0;

  const alternar = (numero: number) => {
    setRetirados((prev) =>
      prev.includes(numero) ? prev.filter((n) => n !== numero) : [...prev, numero].sort((a, b) => a - b)
    );
  };

  const restaurar = () => {
    setRetirados(oficiales);
    setPesos(inicialesPesos(proyeccion));
    setAjustes(AJUSTES_POR_DEFECTO);
  };

  const carrera = proyeccion.carrera;

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------------------- */}
      {/* Controles de pista, parciales y pesos                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid gap-2 rounded-xl border border-line bg-surface p-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            Factor de pista
          </span>
          <select
            value={ajustes.factorPista}
            onChange={(e) => setAjustes((a) => ({ ...a, factorPista: e.target.value as FactorPista }))}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {(Object.keys(ETIQUETA_PISTA) as FactorPista[]).map((k) => (
              <option key={k} value={k}>
                {ETIQUETA_PISTA[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            Comportamiento de pista hoy
          </span>
          <select
            value={ajustes.sesgo}
            onChange={(e) => setAjustes((a) => ({ ...a, sesgo: e.target.value as SesgoPista }))}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {(Object.keys(ETIQUETA_SESGO) as SesgoPista[]).map((k) => (
              <option key={k} value={k}>
                {ETIQUETA_SESGO[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            Parcial 400 m (s)
          </span>
          <input
            type="number"
            step="0.1"
            value={ajustes.parcial400}
            onChange={(e) => setAjustes((a) => ({ ...a, parcial400: Number(e.target.value) || 0 }))}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-[13px] font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </label>

        <div className="flex items-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPesos(inicialesPesos(proyeccion))}
            disabled={!conPesos}
            title={
              conPesos
                ? "Restaura los pesos declarados en el programa del día"
                : "El programa del día no trae pesos declarados"
            }
          >
            ⚖️ Cargar pesos declarados
          </Button>
        </div>

        <div className="flex items-end justify-end">
          <Button size="sm" variant="ghost" onClick={restaurar} title="Restaura retiros, pesos y previa">
            🔄 Restaurar previa
          </Button>
        </div>
      </div>

      {!conPesos && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
          El programa del día no trae pesos declarados para esta carrera. Podés escribirlos a mano en cada ejemplar:
          el ajuste se calcula contra la mediana del lote ({pizarra.pesoReferenciaKg} kg).
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        {/* -------------------------------------------------------------- */}
        {/* PIZARRA                                                         */}
        {/* -------------------------------------------------------------- */}
        <section className="xl:col-span-7 rounded-2xl border-2 border-amber-500 bg-gradient-to-b from-slate-900 via-slate-950 to-black p-3 text-slate-100 shadow-xl">
          <header className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                {pizarra.tren.titulo} · MACTOR + SMIC + actuario
              </p>
              <h3 className="truncate text-sm font-black text-white md:text-base">
                {carrera.hipodromo} · C{carrera.carrera}
                {carrera.distancia ? ` · ${carrera.distancia} m` : ""}
                {carrera.superficie ? ` · ${carrera.superficie}` : ""}
              </h3>
              <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{pizarra.tren.detalle}</p>
            </div>
            <span className="shrink-0 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] font-bold text-emerald-400">
              Activos: {pizarra.totalActivos} · Retirados: {pizarra.totalRetirados}
            </span>
          </header>

          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {pizarra.activos.map((f, idx) => (
              <FilaPizarraUI
                key={f.numero}
                fila={f}
                lider={idx === 0}
                pesoValor={pesos[f.numero] ?? ""}
                onPeso={(v) => setPesos((p) => ({ ...p, [f.numero]: v }))}
                onRetirar={() => alternar(f.numero)}
              />
            ))}

            {pizarra.retirados.map((r) => (
              <div
                key={`ret-${r.numero}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-800/60 bg-rose-950/40 p-2 opacity-90"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                    🚫 Retirado
                  </span>
                  <span className="truncate text-xs font-bold text-slate-300 line-through">
                    #{r.numero} {r.nombre}
                  </span>
                  <span className="text-[10px] text-rose-300">Excluido de la simulación · % redistribuido</span>
                </div>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => alternar(r.numero)}
                  title="Reactivar SOLO en la pizarra; para hacerlo oficial, aplicá los retiros"
                >
                  ↩️ Reactivar
                </Button>
              </div>
            ))}

            {!pizarra.activos.length && (
              <p className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center text-xs text-slate-400">
                No queda ningún ejemplar activo. Reactivá alguno para volver a simular.
              </p>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
            <span className="text-[10px] font-semibold text-slate-400">
              {hayCambios
                ? "⚠️ La pizarra tiene retiros distintos a los oficiales."
                : "✓ Los retiros de la pizarra coinciden con los oficiales."}
            </span>
            <Button
              size="sm"
              variant="danger"
              disabled={!hayCambios || aplicandoRetiros}
              onClick={() => void onAplicarRetiros(retirados)}
              title="Aplica la lista al servicio central: se propaga a Taquilla, Tablas, Marcas y Liquidación"
            >
              {aplicandoRetiros ? "Aplicando…" : "⛔ Aplicar retiros oficiales"}
            </Button>
          </div>
        </section>

        {/* -------------------------------------------------------------- */}
        {/* RECTA FINAL + DICTAMEN                                          */}
        {/* -------------------------------------------------------------- */}
        <div className="xl:col-span-5 space-y-3">
          <section className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wide text-slate-700">
                Simulación recta final · solo activos
              </h4>
              <span className="font-mono text-[10px] font-bold text-amber-600">Meta 🏁</span>
            </div>

            <div
              className="relative min-h-[240px] space-y-1.5 overflow-hidden rounded-xl border-2 border-amber-700 p-2"
              style={{
                background:
                  "repeating-linear-gradient(90deg, #2c1d11, #2c1d11 45px, #3d2817 45px, #3d2817 90px)",
              }}
            >
              <div className="pointer-events-none absolute bottom-0 right-6 top-0 z-10 w-2 bg-gradient-to-b from-white via-red-600 to-white" />
              <div className="relative z-20 space-y-1.5 pr-8">
                {carriles.map((c) => (
                  <div
                    key={c.numero}
                    className="relative flex h-9 items-center rounded-lg border border-amber-900/50 bg-black/35 px-1.5"
                  >
                    <span className="w-28 shrink-0 truncate font-mono text-[10px] text-amber-100/90">
                      #{c.numero} {c.nombre}
                    </span>
                    <div className="relative h-full flex-1">
                      <div
                        className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 transition-all duration-500"
                        style={{ right: `${c.posicionPct}%` }}
                      >
                        <span className="rounded bg-slate-950/90 px-1 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                          {c.puesto}° ({c.probabilidad.toFixed(1)}%)
                        </span>
                        <HorseSaddleclothSvg numero={c.numero} size={30} />
                      </div>
                    </div>
                  </div>
                ))}
                {!carriles.length && (
                  <p className="py-10 text-center text-xs font-semibold text-amber-100/70">
                    Sin ejemplares activos para simular.
                  </p>
                )}
              </div>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-500">
              La posición usa el score acumulado y descuenta la brecha con el remate de 200 m del motor Godet.
            </p>
          </section>

          <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50/60 p-3">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
              Impacto táctico de retiros, tren MACTOR y jugadas actualizadas
            </h4>
            <ul className="space-y-1 text-[11px] leading-relaxed text-slate-700">
              {pizarra.informe.map((linea, i) => (
                <li key={i}>{linea}</li>
              ))}
            </ul>

            <div className="grid grid-cols-1 gap-1.5 border-t border-amber-200 pt-2 sm:grid-cols-3">
              <Ticket etiqueta="Ganador" valor={ticketGanador(pizarra.tickets.ganador)} tono="text-amber-700" />
              <Ticket etiqueta="Exacta sin retirados" valor={pizarra.tickets.exacta} tono="text-emerald-700" />
              <Ticket etiqueta="Trifecta sin retirados" valor={pizarra.tickets.trifecta} tono="text-sky-700" />
            </div>
          </section>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Pizarra del <b>{fecha}</b>. El retiro desde acá es una <b>simulación</b> hasta pulsar «Aplicar retiros
        oficiales»: recién entonces se escribe en la carrera central (mismo camino que Gestión de Jugadas) y se
        propaga a todos los módulos. El estilo E1/E2/E3 es un <b>proxy inferido</b> de velocidad, consistencia y
        distancia, porque la base no registra parciales oficiales por ejemplar.
      </p>
    </div>
  );
}

function ticketGanador(f: FilaPizarra | null): string {
  return f ? `#${f.numero} ${f.nombre}` : "—";
}

function Ticket({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-white p-1.5">
      <span className="block text-[8px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</span>
      <span className={`font-mono text-[11px] font-extrabold ${tono}`}>{valor}</span>
    </div>
  );
}

function FilaPizarraUI({
  fila,
  lider,
  pesoValor,
  onPeso,
  onRetirar,
}: {
  fila: FilaPizarra;
  lider: boolean;
  pesoValor: string;
  onPeso: (v: string) => void;
  onRetirar: () => void;
}) {
  const estilo = ESTILO_CHIP[fila.estilo];
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-slate-900/95 p-2 md:flex-nowrap ${
        lider ? "border-amber-500" : "border-slate-800"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="w-16 shrink-0 text-center">
          <span
            className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
              lider ? "bg-amber-400 text-slate-950" : fila.puesto === 2 ? "bg-slate-200 text-slate-900" : "bg-slate-800 text-slate-300"
            }`}
          >
            {fila.puesto}° lugar
          </span>
          <span className="mt-0.5 block font-mono text-[9px] text-slate-400">
            {fila.puesto === 1 ? "GANADOR" : `${fila.cuerpos.toFixed(1)} cpos`}
          </span>
        </div>

        <HorseSaddleclothSvg numero={fila.numero} size={40} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
              #{fila.numero}
            </span>
            <strong className="truncate text-xs font-black text-white md:text-sm">{fila.nombre}</strong>
            <span className={`rounded border px-1 py-0.5 font-mono text-[9px] font-bold ${estilo.cls}`} title={estilo.detalle}>
              {estilo.label}
            </span>
            {fila.notaPeso && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                {fila.notaPeso}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">
            {fila.jockey ? `${fila.jockey} · ` : ""}
            {fila.entrenador ? `Ent. ${fila.entrenador} · ` : ""}
            SR {fila.speedRating || "—"} · Consist. {fila.consistencia} · Remate 200 m {fila.remate200Seg.toFixed(2)} s
          </p>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <label className="block">
          <span className="block text-[8px] font-bold uppercase tracking-wide text-amber-300">Peso hoy (kg)</span>
          <input
            type="number"
            step="0.5"
            inputMode="decimal"
            placeholder={String(fila.pesoReferenciaKg)}
            value={pesoValor}
            onChange={(e) => onPeso(e.target.value)}
            className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] font-bold text-amber-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
          />
        </label>

        <div className="w-14 text-right">
          <span className="block font-mono text-[10px] font-bold text-slate-300">{fila.score.toFixed(1)}</span>
          <span className="block font-mono text-xs font-extrabold text-emerald-400">{fila.probabilidad.toFixed(1)}%</span>
        </div>

        <Button size="sm" variant="danger" onClick={onRetirar} title="Retirar de la simulación (no escribe en la base)">
          🚫 Retirar
        </Button>
      </div>
    </div>
  );
}

export default PizarraProspectiva;
