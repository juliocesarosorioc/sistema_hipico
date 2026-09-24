"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  asegurarEjemplar,
  bandera,
  exportarPadronCSV,
  filtrarPadron,
  fmtFecha,
  leerPadron,
  NACIONALIDADES,
  nombrePais,
  type EjemplarPadron,
} from "@/lib/gaceta/padron";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";

export function PadronTabla() {
  const [lista, setLista] = useState<EjemplarPadron[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [rls, setRls] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [nacNueva, setNacNueva] = useState("VE");
  const [registrando, setRegistrando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    setRls(false);
    const res = await leerPadron();
    if (!res.ok) {
      setError(res.error ?? "Error cargando el padrón.");
      setRls(!!res.rls);
    } else {
      setLista(res.data);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const registrarNuevo = async () => {
    const nombre = nombreNuevo.trim().toUpperCase();
    if (!nombre) return;
    setRegistrando(true);
    const r = await asegurarEjemplar(nombre, nacNueva);
    setRegistrando(false);
    const ya = r.ok && !r.nuevo;
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: {
          msg: r.ok
            ? ya
              ? `ⓘ "${nombre}" (${nacNueva}) ya estaba en el padrón.`
              : `✅ "${nombre}" (${nacNueva}) registrado en el padrón.`
            : `⚠️ ${r.error ?? "Error al registrar."}`,
          tipo: r.ok ? (ya ? "info" : "success") : "error",
        },
      })
    );
    if (r.ok) {
      setNombreNuevo("");
      void cargar();
    }
  };

  const filtradas = useMemo(() => filtrarPadron(lista, busqueda), [lista, busqueda]);

  const nacionalidades = useMemo(() => {
    const por: Record<string, number> = {};
    lista.forEach((e) => {
      const nac = (e.nacionalidad ?? "VE").toUpperCase();
      por[nac] = (por[nac] || 0) + 1;
    });
    return Object.entries(por).sort(([a], [b]) => a.localeCompare(b));
  }, [lista]);

  const stats = useMemo(
    () => ({
      ejemplares: lista.length,
      nacionalidades: nacionalidades.length,
      vinculados: lista.filter((e) => e.totalTablas > 0).length,
    }),
    [lista, nacionalidades]
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Ejemplares Registrados
          </span>
          <span className="text-3xl font-black text-danger-600">{stats.ejemplares}</span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Nacionalidades
          </span>
          <span className="text-3xl font-black text-warning-600">{stats.nacionalidades}</span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Vinculados a Tablas
          </span>
          <span className="text-3xl font-black text-success-500">{stats.vinculados}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-600">
          🌎 Nacionalidades del Padrón
        </h3>
        <div className="flex flex-wrap gap-2">
          {nacionalidades.length === 0 ? (
            <p className="text-[11px] italic text-slate-500">Sin ejemplares registrados.</p>
          ) : (
            nacionalidades.map(([nac, n]) => {
              const activo = busqueda.trim().toUpperCase() === nac;
              return (
                <button
                  key={nac}
                  type="button"
                  onClick={() => setBusqueda(activo ? "" : nac)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold border transition-colors ${
                    activo
                      ? "border-warning-600 bg-warning-500 text-white shadow"
                      : "border-warning-200 bg-warning-500/10 text-warning-700 hover:bg-warning-500/20"
                  }`}
                  title={`${nombrePais(nac)} — toque para filtrar`}
                >
                  <span>{bandera(nac)}</span>
                  <span>{nac}</span>
                  <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-700">{n}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

<div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              📖 Registro por Nombre y Nacionalidad
            </h3>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex-1 sm:w-72">
                <Input
                  placeholder="Buscar nombre o nacionalidad..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="font-bold uppercase"
                />
              </div>
              <Button variant="success" size="sm" onClick={() => exportarPadronCSV(lista)}>
                CSV
              </Button>
            </div>
          </div>

          {/* Registro manual de un nuevo ejemplar (INSERT en `ejemplares`) */}
          <div className="flex flex-col gap-2 border-b border-line bg-surfaceAlt/40 p-4 lg:flex-row lg:items-end">
            <div className="flex-1">
              <Input
                id="nuevo-ejemplar"
                label="Registrar nuevo ejemplar"
                placeholder="Nombre oficial (ej. Titanium Storm)"
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void registrarNuevo();
                }}
                className="font-bold uppercase"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                <span>Nacionalidad</span>
                <select
                  value={nacNueva}
                  onChange={(e) => setNacNueva(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {NACIONALIDADES.map((n) => (
                    <option key={n} value={n}>
                      {bandera(n)} {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="default" size="md" disabled={registrando || !nombreNuevo.trim()} onClick={() => void registrarNuevo()}>
                {registrando ? "Registrando…" : "＋ Registrar"}
              </Button>
            </div>
          </div>

        {error && (
          <div className="border-b border-line bg-danger-500/10 p-4 text-center text-[11px] text-danger-500">
            <b>Error cargando el padrón.</b>
            <br />
            {rls
              ? "Permisos bloqueados (RLS). Ejecute el SQL del paquete en Supabase (sección 5 desactiva RLS en ejemplares)."
              : error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-surfaceAlt text-slate-500">
              <tr>
                <th className="p-3 font-bold uppercase tracking-wider">Ejemplar (Nombre Oficial)</th>
                <th className="p-3 text-center font-bold uppercase tracking-wider">Nacionalidad</th>
                <th className="p-3 text-center font-bold uppercase tracking-wider">En Tablas</th>
                <th className="p-3 font-bold uppercase tracking-wider">Última Aparición</th>
                <th className="p-3 text-right font-bold uppercase tracking-wider">Registrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-slate-700">
              {cargando ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center italic text-slate-500">
                    Cargando padrón...
                  </td>
                </tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center italic text-slate-500">
                    Sin resultados.
                  </td>
                </tr>
              ) : (
                filtradas.map((e) => {
                  const nac = (e.nacionalidad ?? "VE").toUpperCase();
                  const ve = nac === "VE";
                  return (
                    <tr key={`${e.nombre}|${nac}`} className="hover:bg-surfaceAlt/60">
                      <td className="p-2 font-bold">{e.nombre}</td>
                      <td className="p-2 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold border ${
                            ve
                              ? "border-danger-200 bg-danger-500/10 text-danger-700"
                              : "border-line bg-surfaceAlt text-slate-500"
                          }`}
                          title={nombrePais(nac)}
                        >
                          {bandera(nac)} {nac}
                        </span>
                      </td>
                      <td className={`p-2 text-center font-bold ${e.totalTablas > 0 ? "text-success-500" : "text-slate-500"}`}>
                        {e.totalTablas || 0}
                      </td>
                      <td className="p-2 text-slate-500">{e.ultimaTabla || "-"}</td>
                      <td className="p-2 text-right text-slate-500">{fmtFecha(e.registrado)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] italic leading-relaxed text-slate-500">
        El padrón se alimenta automáticamente al transformar la gaceta o al ensamblar una Tabla Fija:
        cada ejemplar se registra una sola vez por nombre + nacionalidad (los homónimos se distinguen por su país
        de origen; los hipódromos de EE.UU. quedan como USA por defecto y los de Venezuela como VE).
      </p>

      <ToastHost />
    </div>
  );
}

export default PadronTabla;