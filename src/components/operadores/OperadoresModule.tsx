"use client";

/**
 * ============================================================================
 * OPERADORES — pantalla (reemplazo moderno de html/operadores.html)
 * ============================================================================
 *
 * NO reproduce el CRUD legacy sobre `public.operadores` (contraseñas en claro,
 * tabla retirada). Lo que sí migra es la RELACIÓN CON HIPÓDROMOS: qué hipódromos
 * opera cada usuario, guardada como el atributo ABAC `usuario_hipodromos`.
 *
 * El alta de usuarios y la matriz de permisos viven en Seguridad y Accesos
 * (pestaña Usuarios); acá se enlaza directo para no duplicar esa pantalla.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { Guard } from "@/shared/components/ui/Guard";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { listarOperadores, guardarHipodromosDeOperador, type Operador } from "@/lib/operadores";
import { listarHipodromos } from "@/lib/hipodromos/servicio";
import { estaBorrado, type Hipodromo } from "@/lib/hipodromos/tipos";

export function OperadoresModule() {
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [hipodromos, setHipodromos] = useState<Hipodromo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Operador | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const refrescar = useCallback(async () => {
    const [ops, hips] = await Promise.all([listarOperadores(), listarHipodromos()]);
    setOperadores(ops.data);
    setHipodromos(hips.data.filter((h) => !estaBorrado(h)));
    setCargando(false);
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return operadores;
    return operadores.filter(
      (o) => (o.nombre ?? "").toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
    );
  }, [operadores, busqueda]);

  const abrirAsignacion = (o: Operador) => {
    setEditando(o);
    setSeleccion(new Set(o.hipodromos.map((h) => h.toUpperCase())));
  };

  const alternarHipodromo = (nombre: string) => {
    const n = nombre.toUpperCase();
    setSeleccion((s) => {
      const copia = new Set(s);
      if (copia.has(n)) copia.delete(n);
      else copia.add(n);
      return copia;
    });
  };

  const guardar = async () => {
    if (!editando) return;
    setGuardando(true);
    const res = await guardarHipodromosDeOperador(editando.id, [...seleccion]);
    setGuardando(false);
    if (!res.ok) return toast(res.error ?? "No se pudieron guardar los hipódromos.", "error");
    toast(
      seleccion.size
        ? `✅ ${seleccion.size} hipódromo(s) asignados a ${editando.nombre ?? editando.id}.`
        : `Se quitó la asignación de hipódromos a ${editando.nombre ?? editando.id}.`,
      "success"
    );
    setEditando(null);
    void refrescar();
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-wide text-slate-800">👥 Operadores</h1>
          <p className="text-[11px] text-slate-500">
            Personal del sistema y los hipódromos que cada uno opera.
          </p>
        </div>
        <Link
          href="/seguridad?pestana=usuarios"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-bold uppercase text-slate-700 transition-colors hover:bg-surfaceAlt"
        >
          Alta y permisos → Seguridad
        </Link>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
        <b className="uppercase">Nota de seguridad:</b> la tabla legacy <code>operadores</code> (con la
        contraseña en texto plano) quedó <b>retirada</b>. El alta, el tipo y los permisos se administran
        en <Link href="/seguridad?pestana=usuarios" className="font-bold underline">Seguridad → Usuarios</Link>.
        Acá se administra lo único que faltaba: <b>qué hipódromos opera cada usuario</b> (atributo
        <code> usuario_hipodromos</code>). Un operador sin hipódromos asignados no queda atado a ninguno.
      </div>

      <Card className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 bg-slate-900 p-3.5 text-xs font-bold uppercase tracking-wider text-white">
          <span>Usuarios del sistema</span>
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
                <th className="p-3 font-bold uppercase tracking-wider">Usuario</th>
                <th className="p-3 font-bold uppercase tracking-wider">Tipo</th>
                <th className="p-3 text-center font-bold uppercase tracking-wider">Estado</th>
                <Guard permiso="operadores:celda_hipodromos">
                  <th className="p-3 font-bold uppercase tracking-wider">Hipódromos asignados</th>
                </Guard>
                <th className="p-3 text-center font-bold uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cargando ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center italic text-slate-500">
                    Cargando operadores…
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center italic text-slate-500">
                    No hay usuarios {busqueda ? "que coincidan con la búsqueda" : "registrados"}.
                  </td>
                </tr>
              ) : (
                filtrados.map((o) => (
                  <tr key={o.id} className="hover:bg-surfaceAlt/60">
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{o.nombre || "—"}</div>
                      <div className="text-[10px] text-slate-500">{o.id}</div>
                    </td>
                    <td className="p-3">
                      <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-700">
                        {o.tipo || "sin tipo"}
                      </span>
                      {o.esPrincipal ? (
                        <span className="ml-1 rounded bg-indigo-100 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700">
                          principal
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 text-center">
                      {o.activo === false ? (
                        <span className="rounded bg-red-100 px-2 py-1 font-bold text-red-700">Inactivo</span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-1 font-bold text-emerald-700">Activo</span>
                      )}
                    </td>
                    <Guard permiso="operadores:celda_hipodromos">
                      <td className="p-3">
                        {o.hipodromos.length === 0 ? (
                          <span className="text-[10px] italic text-slate-400">Todos / sin restricción</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {o.hipodromos.map((h) => (
                              <span
                                key={h}
                                className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700"
                              >
                                {h}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </Guard>
                    <td className="whitespace-nowrap p-3 text-center">
                      <Guard permiso="seguridad:fn_personalizar_usuario">
                        <Button variant="outline" size="sm" onClick={() => abrirAsignacion(o)}>
                          🗺️ Hipódromos
                        </Button>
                      </Guard>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de asignación de hipódromos */}
      {editando ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">
                🗺️ Hipódromos de <span className="normal-case">{editando.nombre || editando.id}</span>
              </h3>
              <button type="button" onClick={() => setEditando(null)} className="text-slate-300 hover:text-white">
                ✕
              </button>
            </div>
            <div className="max-h-[55vh] space-y-1 overflow-y-auto p-4">
              {hipodromos.length === 0 ? (
                <p className="p-4 text-center text-[11px] italic text-slate-500">
                  No hay hipódromos en el catálogo.
                </p>
              ) : (
                hipodromos.map((h) => {
                  const n = h.nombre.toUpperCase();
                  const marcado = seleccion.has(n);
                  return (
                    <label
                      key={h.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-surfaceAlt"
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternarHipodromo(h.nombre)}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <span className="font-bold">{h.nombre}</span>
                      <span className="text-[10px] text-slate-400">{h.pais}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <span className="text-[10px] text-slate-500">
                {seleccion.size ? `${seleccion.size} seleccionado(s)` : "Sin asignar (opera todos)"}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
                <Button variant="default" size="sm" onClick={guardar} disabled={guardando}>
                  {guardando ? "Guardando…" : "💾 Guardar"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ToastHost />
    </section>
  );
}

export default OperadoresModule;
