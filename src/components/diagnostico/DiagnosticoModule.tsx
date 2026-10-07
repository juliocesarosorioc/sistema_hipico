"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Guard } from "@/components/ui/Guard";
import { correrDiagnostico, repararMatrizDesdeTablas, type Chequeo, type ResultadoDiagnostico } from "@/lib/diagnostico";

const ESTILO: Record<Chequeo["estado"], { chip: string; borde: string; texto: string; punto: string; etiqueta: string }> = {
  ok: {
    chip: "bg-emerald-50 text-emerald-700",
    borde: "border-emerald-200",
    texto: "text-emerald-700",
    punto: "\u{1F7E2}",
    etiqueta: "Correcto",
  },
  aviso: {
    chip: "bg-amber-50 text-amber-700",
    borde: "border-amber-200",
    texto: "text-amber-700",
    punto: "\u26A0\uFE0F",
    etiqueta: "Revisar",
  },
  error: {
    chip: "bg-rose-50 text-rose-700",
    borde: "border-rose-200",
    texto: "text-rose-700",
    punto: "\u{1F534}",
    etiqueta: "Problema",
  },
};

function Tarjeta({ c }: { c: Chequeo }) {
  const e = ESTILO[c.estado];
  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm ${e.borde}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 ${e.chip}`}>
            <span aria-hidden>{e.punto}</span>
            <span className="text-[9px] font-black uppercase tracking-widest">{c.area}</span>
          </div>
          <p className="mt-1.5 text-xs font-black leading-tight text-slate-800">{c.titulo}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-600">{c.detalle}</p>
        </div>
        <div className="shrink-0 text-right">
          {c.conteo != null ? (
            <div className={`text-lg font-black leading-none ${e.texto}`}>{c.conteo}</div>
          ) : null}
          <div className={`mt-0.5 text-[9px] font-bold uppercase tracking-wide ${e.texto}`}>
            {e.etiqueta}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DiagnosticoModule() {
  const [datos, setDatos] = useState<ResultadoDiagnostico | null>(null);
  const [cargando, setCargando] = useState(false);
  const [reparando, setReparando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const correr = useCallback(async () => {
    setCargando(true);
    setMensaje(null);
    const r = await correrDiagnostico();
    setDatos(r);
    setCargando(false);
  }, []);

  useEffect(() => {
    void correr();
  }, [correr]);

  const reparar = async () => {
    setReparando(true);
    setMensaje(null);
    const r = await repararMatrizDesdeTablas();
    setReparando(false);
    if (!r.ok) {
      setMensaje(`No se pudo reparar: ${r.error ?? "error desconocido"}`);
    } else {
      const partes = [
        r.creadas ? `${r.creadas} carreras creadas en la matriz` : "",
        r.hipodromosEnlazados ? `${r.hipodromosEnlazados} hipódromos enlazados` : "",
        r.resultadosEnlazados ? `${r.resultadosEnlazados} resultados enlazados` : "",
      ].filter(Boolean);
      setMensaje(
        partes.length
          ? `Reparado: ${partes.join(" · ")}.`
          : "Nada que reparar: la matriz ya estaba al día."
      );
    }
    await correr();
  };

  const porArea = (datos?.chequeos ?? []).reduce<Record<string, Chequeo[]>>((acc, c) => {
    (acc[c.area] ||= []).push(c);
    return acc;
  }, {});

  const reparable = (datos?.faltantes.length ?? 0) > 0;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
            <span aria-hidden>{"\u{1F9EA}"}</span> Diagnóstico
          </h1>
          <p className="text-[11px] text-slate-500">
            Sanidad del catálogo de carreras y de lo que hay alrededor. Solo lee, salvo que
            pulses reparar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void correr()} disabled={cargando} variant="ghost">
            {cargando ? "\u23F3 Analizando…" : "\u{1F504} Volver a correr"}
          </Button>
          <Guard permiso="carreras:fn_registrar_carrera">
            <Button onClick={() => void reparar()} disabled={reparando || !reparable}>
              {reparando ? "\u23F3 Reparando…" : "\u{1F527} Reparar matriz"}
            </Button>
          </Guard>
        </div>
      </header>

      {datos ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={`rounded-full border px-2 py-0.5 font-black ${ESTILO[datos.errores ? "error" : "ok"].chip}`}
          >
            {datos.errores} problema{datos.errores === 1 ? "" : "s"}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 font-black ${ESTILO[datos.avisos ? "aviso" : "ok"].chip}`}
          >
            {datos.avisos} por revisar
          </span>
          <span className="text-slate-400">Actualizado {new Date(datos.generado).toLocaleString("es-VE")}</span>
        </div>
      ) : null}

      {mensaje ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-800">
          {mensaje}
        </div>
      ) : null}

      {cargando && !datos ? (
        <div className="py-10 text-center text-xs text-slate-400">Cargando chequeos…</div>
      ) : (
        Object.entries(porArea).map(([area, lista]) => (
          <section key={area}>
            <h2 className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">{area}</h2>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((c) => (
                <Tarjeta key={c.id} c={c} />
              ))}
            </div>
          </section>
        ))
      )}

      {datos?.faltantes.length ? (
        <details className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-black text-amber-800">
            Carreras publicadas que no están en la matriz ({datos.faltantes.length})
          </summary>
          <ul className="mt-1 max-h-48 overflow-auto text-[10px] text-amber-900">
            {datos.faltantes.map((k) => (
              <li key={k} className="truncate">
                {k.split("|").join(" · ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
