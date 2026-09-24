"use client";

import { useMemo, useState } from "react";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import type { EjemplarTabla } from "@/lib/tablas/tipos";
import { OPCIONES_NACIONALIDAD, SUPERFICIES, colorDeNumero, textoDeNumero, fmtMoney, parseNum } from "@/lib/tablas/tipos";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Button } from "@/components/ui/Button";
import { listarHipodromos } from "@/lib/tablas/rpc";
import { useEffect } from "react";

type Props = {
  onPublicar: (tabla: TablaFijaRow) => Promise<boolean>;
};

function filaVacia(): EjemplarTabla {
  return { numero: "", nombre: "", nacionalidad: "VE", valor_ejemplar: "" };
}

/**
 * Ensamblaje de Tabla Fija (clon 1:1 de la pestaña Ensamblaje del legacy).
 * Parámetros de carrera + lista de ejemplares (paleta de 14 gualdrapas,
 * bandera de nacionalidad) y monto por ejemplar. Al publicar, se envía la
 * fila completa al store para el Monitor.
 */
export function EnsamblajeTabla({ onPublicar }: Props) {
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("1");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [distancia, setDistancia] = useState("1200");
  const [superficie, setSuperficie] = useState<string>(SUPERFICIES[0]);
  const [premioOriginal, setPremioOriginal] = useState("");
  const [limiteVentas, setLimiteVentas] = useState("");
  const [moneda, setMoneda] = useState("VES");
  const [hipodromos, setHipodromos] = useState<Array<{ value: string; label: string }>>([]);
  const [ejemplares, setEjemplares] = useState<EjemplarTabla[]>([filaVacia()]);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    listarHipodromos().then(setHipodromos);
  }, []);

  const setFila = (i: number, patch: Partial<EjemplarTabla>) =>
    setEjemplares((e) => e.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const suma = useMemo(() =>
    ejemplares.reduce((a, c) => a + parseNum(c.valor_ejemplar), 0),
  [ejemplares]);

  const publicar = async () => {
    if (!hipodromo.trim()) return setMensaje("Indica el hipódromo.");
    if (!carrera.trim()) return setMensaje("Indica el número de carrera.");
    const caballos = ejemplares.filter((c) => c.nombre.trim());
    if (caballos.length < 2) return setMensaje("Carga al menos 2 ejemplares para armar la tabla.");

    const fila: TablaFijaRow = {
      id: `${hipodromo.toUpperCase().trim().replace(/\s+/g, "-")}-${carrera}`,
      hipodromo: hipodromo.toUpperCase().trim(),
      carrera: Number(carrera) || 1,
      fecha,
      estado: "Abierta",
      distancia_carrera: distancia,
      superficie,
      premio_original: parseNum(premioOriginal) || suma,
      premio_recalculado: parseNum(premioOriginal) || suma,
      suma_base_tabla: suma,
      limite_ventas: parseNum(limiteVentas) || 0,
      cantidad_vendida: 0,
      moneda,
      retirados_oficiales: null,
      caballos,
    };

    const ok = await onPublicar(fila);
    if (!ok) {
      setMensaje(`❌ No se pudo publicar ${fila.hipodromo} C${fila.carrera}. Revisa la conexión con Supabase.`);
      return;
    }
    setEjemplares([filaVacia()]);
    setPremioOriginal("");
    setMensaje(`✅ Tabla ${fila.hipodromo} C${fila.carrera} publicada.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-black uppercase text-slate-900">🔧 Ensamblaje de Tabla</h2>
          <p className="text-xs text-slate-500">Parámetros de la carrera + ejemplares participantes.</p>
        </div>
        <span className="rounded-full bg-primary-500/10 px-3 py-1 text-[10px] font-black uppercase text-primary-700">
          Pestaña Activada
        </span>
      </div>

      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4 lg:grid-cols-4">
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
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Carrera</label>
          <input
            value={carrera}
            onChange={(e) => setCarrera(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Distancia (m)</label>
          <input
            value={distancia}
            onChange={(e) => setDistancia(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Superficie</label>
          <select
            value={superficie}
            onChange={(e) => setSuperficie(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {SUPERFICIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Premio Original</label>
          <input
            value={premioOriginal}
            onChange={(e) => setPremioOriginal(e.target.value)}
            inputMode="decimal"
            placeholder="ej. 1000"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Límite de Ventas</label>
          <input
            value={limiteVentas}
            onChange={(e) => setLimiteVentas(e.target.value)}
            inputMode="numeric"
            placeholder="ej. 500"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Moneda</label>
          <select
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <option value="VES">🇻🇪 Bolívares (VES)</option>
            <option value="USD">🇺🇸 Dólares (USD)</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Lista de Ejemplares</h3>
          <span className="text-[10px] font-semibold text-slate-500">
            Suma de la Tabla: <b>{fmtMoney(suma, moneda)}</b>
          </span>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="w-12 py-1.5 pr-2">Nº</th>
              <th className="py-1.5 pr-2">Casaca</th>
              <th className="py-1.5 pr-2">Nombre del Ejemplar</th>
              <th className="w-28 py-1.5 pr-2">Nacionalidad</th>
              <th className="w-24 py-1.5 pr-2">Monto</th>
              <th className="w-12 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ejemplares.map((f, i) => (
              <tr key={i} className="align-middle">
                <td className="py-1.5 pr-2">
                  <span
                    className="grid h-7 w-9 place-items-center rounded-md text-xs font-black"
                    style={{ backgroundColor: f.numero ? colorDeNumero(f.numero) : "#e2e8f0", color: f.numero ? textoDeNumero(f.numero) : "#94a3b8" }}
                  >
                    {f.numero || i + 1}
                  </span>
                </td>
                <td className="px-2">
                  <input
                    value={f.numero}
                    onChange={(e) => setFila(i, { numero: e.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="Nº"
                    inputMode="numeric"
                    className="w-14 rounded-md border border-line bg-surface px-2 py-1.5 text-center text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </td>
                <td className="px-2">
                  <input
                    value={f.nombre}
                    onChange={(e) => setFila(i, { nombre: e.target.value.toUpperCase() })}
                    placeholder="Nombre del ejemplar…"
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </td>
                <td className="px-2">
                  <select
                    value={f.nacionalidad || "VE"}
                    onChange={(e) => setFila(i, { nacionalidad: e.target.value })}
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {OPCIONES_NACIONALIDAD.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2">
                  <input
                    value={f.valor_ejemplar as string}
                    onChange={(e) => setFila(i, { valor_ejemplar: e.target.value })}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-right text-sm font-black text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    type="button"
                    onClick={() => setEjemplares((e) => e.filter((_, j) => j !== i))}
                    disabled={ejemplares.length <= 1}
                    className="text-slate-300 transition-colors hover:text-red-500"
                    aria-label="Quitar fila"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setEjemplares((e) => [...e, filaVacia()])}>
            ＋ Agregar ejemplar
          </Button>
          <Button size="sm" onClick={() => setEjemplares(ejemplares.map((f) => ({ ...f, valor_ejemplar: "" })))}>
            Vaciar montos
          </Button>
          <Button variant="success" size="md" className="ml-auto" onClick={publicar}>
            📢 Publicar Tabla
          </Button>
        </div>
        {mensaje && <p className="mt-2 text-xs font-semibold text-slate-600">{mensaje}</p>}
      </div>
    </div>
  );
}

export default EnsamblajeTabla;