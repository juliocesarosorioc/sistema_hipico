"use client";

/**
 * ============================================================================
 * REGLAS DE JUGADAS — pantalla (migración de html/tipos_jugadas.html)
 * ============================================================================
 *
 * Panel de formulario a la izquierda + tabla de jugadas del sistema a la
 * derecha, igual que el legacy. Cada control de escritura está envuelto en un
 * `<Guard>`: la capacidad sale del registro maestro y el servicio la vuelve a
 * exigir (`exigirCapacidad`), así que un usuario sin permiso no puede escribir
 * ni desde la consola.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Guard } from "@/components/ui/Guard";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";
import {
  alternarTipoJugada,
  eliminarTipoJugada,
  etiquetaCalculo,
  etiquetaComision,
  guardarTipoJugada,
  listarTiposJugada,
  type ComisionBase,
  type DatosTipoJugada,
  type TipoCalculo,
  type TipoJugada,
} from "@/lib/tipos-jugadas";

type Formulario = {
  id: string | null;
  nombre: string;
  comision_porcentaje: string;
  comision_base: ComisionBase;
  tipo_calculo: TipoCalculo;
  premio_a_pagar: string;
  permite_cruces: boolean;
  activo: boolean;
};

const FORM_VACIO: Formulario = {
  id: null,
  nombre: "",
  comision_porcentaje: "5",
  comision_base: "PREMIO",
  tipo_calculo: "POR_UNIDAD",
  premio_a_pagar: "1",
  permite_cruces: true,
  activo: true,
};

const aFormulario = (j: TipoJugada): Formulario => ({
  id: j.id,
  nombre: j.nombre,
  comision_porcentaje: String(j.comision_porcentaje),
  comision_base: j.comision_base,
  tipo_calculo: j.tipo_calculo,
  premio_a_pagar: String(j.premio_a_pagar),
  permite_cruces: j.permite_cruces,
  activo: j.activo,
});

export function ReglasJugadasModule() {
  const [jugadas, setJugadas] = useState<TipoJugada[]>([]);
  const [local, setLocal] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState<Formulario>(FORM_VACIO);
  const [busqueda, setBusqueda] = useState("");

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const refrescar = useCallback(async () => {
    const res = await listarTiposJugada();
    setJugadas(res.data);
    setLocal(Boolean(res.local));
    setCargando(false);
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? jugadas.filter((j) => j.nombre.toLowerCase().includes(q)) : jugadas;
  }, [jugadas, busqueda]);

  const guardar = async () => {
    const datos: DatosTipoJugada = {
      nombre: form.nombre,
      comision_porcentaje: parseFloat(form.comision_porcentaje) || 0,
      comision_base: form.comision_base,
      tipo_calculo: form.tipo_calculo,
      premio_a_pagar: parseFloat(form.premio_a_pagar) || 0,
      permite_cruces: form.permite_cruces,
      activo: form.activo,
    };
    if (!datos.nombre.trim()) return toast("Escriba el nombre de la jugada.", "warning");

    setGuardando(true);
    const res = await guardarTipoJugada(form.id, datos);
    setGuardando(false);
    if (!res.ok) return toast(res.error ?? "No se pudo guardar la regla.", "error");

    toast(form.id ? `✅ Regla "${datos.nombre.toUpperCase()}" actualizada.` : `✅ Regla "${datos.nombre.toUpperCase()}" creada.`, "success");
    setForm(FORM_VACIO);
    void refrescar();
  };

  const editar = (j: TipoJugada) => {
    setForm(aFormulario(j));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const alternar = async (j: TipoJugada) => {
    const res = await alternarTipoJugada(j.id, !j.activo);
    if (!res.ok) return toast(res.error ?? "No se pudo cambiar el estado.", "error");
    toast(`Regla "${j.nombre}" ${j.activo ? "desactivada" : "activada"}.`, "success");
    void refrescar();
  };

  const eliminar = async (j: TipoJugada) => {
    if (
      !window.confirm(
        `¿Eliminar la jugada "${j.nombre}"?\n\nSi hay tickets usándola, la eliminación puede fallar. ` +
          `Si solo querés dejar de ofrecerla, desactivala.`
      )
    )
      return;
    const res = await eliminarTipoJugada(j.id);
    if (!res.ok) return toast(res.error ?? "No se pudo eliminar.", "error");
    toast(`Regla "${j.nombre}" eliminada.`, "success");
    if (form.id === j.id) setForm(FORM_VACIO);
    void refrescar();
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-wide text-slate-800">⚙️ Reglas de Jugadas (Cobro / Pago)</h1>
          <p className="text-[11px] text-slate-500">
            Motor de cálculo: comisión de la casa, base de cobro, pago si gana y cruces de cada jugada.
          </p>
        </div>
        {local ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase text-amber-700">
            Sin conexión · catálogo de respaldo
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ---------------- Formulario ---------------- */}
        <Card className="flex flex-col gap-3 self-start p-5">
          <h2 className="border-b border-line pb-2 text-sm font-bold uppercase tracking-wide text-slate-800">
            {form.id ? `Editando: ${form.nombre}` : "Registrar Jugada"}
          </h2>

          <Input
            label="Nombre de la jugada"
            placeholder="Ej: GANADOR"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value.toUpperCase() }))}
          />

          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Comisión %"
              type="number"
              min={0}
              step={0.1}
              value={form.comision_porcentaje}
              onChange={(e) => setForm((f) => ({ ...f, comision_porcentaje: e.target.value }))}
            />
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <span>Base de comisión</span>
              <select
                value={form.comision_base}
                onChange={(e) => setForm((f) => ({ ...f, comision_base: e.target.value as ComisionBase }))}
                className="rounded-lg border border-line bg-surface px-2 py-2 text-xs font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <option value="PREMIO">Sobre Premio (gana)</option>
                <option value="MONTO">Sobre Monto (pierde)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <span>Tipo de cálculo</span>
              <select
                value={form.tipo_calculo}
                onChange={(e) => setForm((f) => ({ ...f, tipo_calculo: e.target.value as TipoCalculo }))}
                className="rounded-lg border border-line bg-surface px-2 py-2 text-xs font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <option value="POR_UNIDAD">Por Unidad (juega X $)</option>
                <option value="POR_TABLA">Por Tabla (fija/pizarra)</option>
              </select>
            </label>
            <Input
              label="Pago si gana (× monto)"
              type="number"
              min={0}
              step={0.01}
              value={form.premio_a_pagar}
              onChange={(e) => setForm((f) => ({ ...f, premio_a_pagar: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.permite_cruces}
                onChange={(e) => setForm((f) => ({ ...f, permite_cruces: e.target.checked }))}
                className="h-4 w-4 accent-primary-600"
              />
              Permite cruces (2x3)
            </label>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                className="h-4 w-4 accent-success-600"
              />
              Activa
            </label>
          </div>

          <div className="flex gap-2">
            <Guard permiso="reglas_jugadas:btn_guardar">
              <Button variant="default" onClick={guardar} disabled={guardando} className="flex-1">
                {guardando ? "Guardando…" : "💾 Guardar"}
              </Button>
            </Guard>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(FORM_VACIO)}>
                Cancelar
              </Button>
            ) : null}
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-[10px] leading-relaxed text-slate-600">
            <b className="uppercase text-blue-700">Cómo se calcula:</b>
            <br />
            <b>Cobrar</b> (al registrar) = monto × número de cruces.
            <br />
            <b>Pagar</b> (si gana): tabla → cantidad × premio de la tabla; otro → monto × pago si gana.
            <br />
            <b>Perder</b>: no se paga; la comisión se calcula sobre el monto.
          </div>
        </Card>

        {/* ---------------- Tabla ---------------- */}
        <Card className="flex flex-col overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between gap-3 bg-slate-900 p-3.5 text-xs font-bold uppercase tracking-wider text-white">
            <span>Jugadas del Sistema</span>
            <input
              type="text"
              placeholder="Buscar…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-normal normal-case text-white placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surfaceAlt text-slate-700">
                <tr>
                  <th className="p-3 font-bold uppercase tracking-wider">Jugada</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Comisión</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Cálculo</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Pago si Gana</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Cruces</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Estado</th>
                  <th className="p-3 text-center font-bold uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cargando ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center italic text-slate-500">
                      Cargando reglas…
                    </td>
                  </tr>
                ) : filtradas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center italic text-slate-500">
                      No hay jugadas {busqueda ? "que coincidan con la búsqueda" : "registradas"}.
                    </td>
                  </tr>
                ) : (
                  filtradas.map((j) => (
                    <tr key={j.id} className="hover:bg-surfaceAlt/60">
                      <td className="p-3 font-bold uppercase text-slate-900">{j.nombre}</td>
                      <td className="p-3 text-center font-bold text-purple-700">{etiquetaComision(j)}</td>
                      <td className="p-3 text-center text-slate-600">{etiquetaCalculo(j)}</td>
                      <td className="p-3 text-center font-bold text-emerald-600">{j.premio_a_pagar}×</td>
                      <td className="p-3 text-center">
                        {j.permite_cruces ? <span className="font-bold text-blue-600">Sí</span> : <span className="text-slate-400">No</span>}
                      </td>
                      <td className="p-3 text-center">
                        {j.activo ? (
                          <span className="rounded bg-emerald-100 px-2 py-1 font-bold text-emerald-700">Activo</span>
                        ) : (
                          <span className="rounded bg-red-100 px-2 py-1 font-bold text-red-700">Inactivo</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-center">
                        <Guard permiso="reglas_jugadas:btn_guardar">
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => editar(j)}
                            className="px-2 py-1 text-blue-500 transition-colors hover:text-blue-700"
                          >
                            ✏️
                          </button>
                        </Guard>
                        <Guard permiso="reglas_jugadas:btn_toggle">
                          <button
                            type="button"
                            title="Activar / Desactivar"
                            onClick={() => void alternar(j)}
                            className="px-2 py-1 text-slate-400 transition-colors hover:text-emerald-500"
                          >
                            ⏻
                          </button>
                        </Guard>
                        <Guard permiso="reglas_jugadas:btn_eliminar">
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={() => void eliminar(j)}
                            className="px-2 py-1 text-red-400 transition-colors hover:text-red-600"
                          >
                            🗑️
                          </button>
                        </Guard>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ToastHost />
    </section>
  );
}

export default ReglasJugadasModule;
