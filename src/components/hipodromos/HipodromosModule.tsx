"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";
import { banderas } from "@/lib/tablas/tipos";
import {
  listarHipodromos,
  crearHipodromo,
  actualizarHipodromo,
  eliminarHipodromo,
} from "@/lib/hipodromos/servicio";
import { formatearNombre, levenshteinNorm, PAISES, type Hipodromo } from "@/lib/hipodromos/tipos";

const BANDERA = (pais: string): string => banderas[(pais || "OTRO").toUpperCase()] ?? "🌐";
const estActiva = (estado: string) => (estado || "Activo") === "Activo";

type FormModal = { abierta: boolean; editando: Hipodromo | null; nombre: string; pais: string; estado: string };

const inicialModal = (editando: Hipodromo | null): FormModal => ({
  abierta: !!editando,
  editando,
  nombre: editando?.nombre ?? "",
  pais: (editando?.pais || "VE").toUpperCase(),
  estado: editando?.estado || "Activo",
});

/**
 * Módulo Hipódromos — migración del legacy js/hipodromos.js:
 * catálogo con buscardor, "Nuevo Hipódromo", tabla interactiva (nombre/pais/
 * estado/fecha), Editar y Eliminar por fila, y modal de creación/edición.
 * La tabla se refresca tras cada operación Y en vivo vía realtime (otras
 * sesiones) — sin recargar la página.
 */
export function HipodromosModule() {
  const [hipodromos, setHipodromos] = useState<Hipodromo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [local, setLocal] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal] = useState<FormModal>(() => inicialModal(null));
  const [guardando, setGuardando] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const refrescar = useCallback(async () => {
    const res = await listarHipodromos();
    setHipodromos(res.data);
    setLocal(Boolean(res.local));
    setCargando(false);
  }, []);

  // Carga inicial
  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  // Realtime defensivo: refleja cambios hechos por otras sesiones (mismo backend).
  useEffect(() => {
    let canal: { unsubscribe: () => void } | null = null;
    (async () => {
      const { supabase } = await import("@/lib/supabase");
      if (!supabase) return;
      try {
        canal = supabase
          .channel(`hipodromos-live-${Date.now()}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "hipodromos" }, () => {
            void refrescar();
          })
          .subscribe();
      } catch {
        /* sin realtime → refresco manual */
      }
    })();
    return () => {
      try {
        canal?.unsubscribe();
      } catch {
        /* noop */
      }
    };
  }, [refrescar]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? hipodromos.filter((h) => h.nombre.toLowerCase().includes(q)) : hipodromos;
  }, [hipodromos, busqueda]);

  const abrirNuevo = () => {
    setModal(inicialModal(null));
    setModal((m) => ({ ...m, abierta: true }));
  };

  const abrirEditar = (h: Hipodromo) => setModal(inicialModal(h));

  const cerrarModal = () => setModal(inicialModal(null));

  const guardar = async () => {
    const nombre = formatearNombre(modal.nombre);
    if (!nombre) return toast("Escriba el nombre del hipódromo.", "warning");

    // Validación fuzzy (misma del legacy): evita cuasi-duplicados por país.
    const duplicado = hipodromos.find(
      (h) =>
        h.pais.toUpperCase() === modal.pais.toUpperCase() &&
        String(h.id) !== String(modal.editando?.id ?? "") &&
        levenshteinNorm(h.nombre, nombre) < 0.15
    );
    if (duplicado) {
      return toast(`Ya existe un hipódromo muy similar: "${duplicado.nombre}" (${duplicado.pais}). No se permite duplicados.`, "warning");
    }

    setGuardando(true);
    const res = modal.editando
      ? await actualizarHipodromo(modal.editando.id, { nombre, pais: modal.pais, estado: modal.estado })
      : await crearHipodromo({ nombre, pais: modal.pais });
    setGuardando(false);

    if (!res.ok) {
      if (res.code === "23505") return toast(`El hipódromo "${nombre}" ya existe en el catálogo.`, "warning");
      return toast(res.error ?? "Error al guardar el hipódromo.", "error");
    }
    toast(modal.editando ? `✅ Hipódromo "${nombre}" actualizado.` : `✅ Hipódromo "${nombre}" creado.`, "success");
    cerrarModal();
    void refrescar();
  };

  const eliminar = async (h: Hipodromo) => {
    if (!window.confirm(`¿Eliminar el hipódromo "${h.nombre}"?\nEsta acción no se puede deshacer.`)) return;
    const res = await eliminarHipodromo(h.id);
    if (!res.ok) {
      toast("Error al eliminar. Puede haber tablas o tickets asociados.", "error");
      return;
    }
    toast(`🗑️ Hipódromo "${h.nombre}" eliminado.`, "success");
    void refrescar();
  };

  const selectCls =
    "rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

  return (
    <section className="flex flex-col gap-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-black uppercase tracking-wide text-slate-900">🏇 Hipódromos</h1>
          <p className="text-xs text-slate-500">
            {hipodromos.length} registrados{local ? " · modo respaldo (sin conexión)" : " · sincronizado con Supabase"}.
          </p>
        </div>
        <Button variant="success" size="md" onClick={abrirNuevo}>
          ＋ Nuevo Hipódromo
        </Button>
      </div>

      {/* Buscador */}
      <div className="flex items-center gap-2">
        <Input
          id="buscador-hipodromos"
          label="Buscar"
          placeholder="Filtrar por nombre…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-[11px] font-bold text-slate-400">{filtrados.length} mostrando</span>
      </div>

      {/* Tabla interactiva */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-gray-50 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2.5 font-black">Nombre</th>
                <th className="px-4 py-2.5 font-black">País</th>
                <th className="px-4 py-2.5 font-black">Estado</th>
                <th className="px-4 py-2.5 font-black">Creado</th>
                <th className="px-4 py-2.5 text-right font-black">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {cargando && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs font-semibold text-slate-500">
                    Cargando catálogo…
                  </td>
                </tr>
              )}
              {!cargando && filtrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs italic text-slate-400">
                    No hay hipódromos registrados todavía.
                  </td>
                </tr>
              )}
              {filtrados.map((h) => {
                const activo = estActiva(h.estado);
                return (
                  <tr key={String(h.id)} className="transition-colors hover:bg-surfaceAlt">
                    <td className="px-4 py-2.5">
                      <p className="font-black uppercase tracking-wide text-slate-800">{h.nombre}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-slate-600">
                        <span className="text-base leading-none">{BANDERA(h.pais)}</span>
                        {h.pais}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase leading-none ${
                          activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                      {h.fecha_creacion ? new Date(h.fecha_creacion).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => abrirEditar(h)}>
                          ✏️ Editar
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => void eliminar(h)} title="Eliminar hipódromo">
                          🗑️
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal crear / editar */}
      {modal.abierta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Card className="w-full max-w-md p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">
                {modal.editando ? "✏️ Editar hipódromo" : "＋ Nuevo hipódromo"}
              </h2>
              <button type="button" onClick={cerrarModal} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <Input
                id="hipodromo-nombre"
                label="Nombre"
                placeholder="Ej. La Rinconada"
                value={modal.nombre}
                onChange={(e) => setModal((m) => ({ ...m, nombre: e.target.value }))}
                autoFocus
              />

              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                <span>País</span>
                <select
                  value={modal.pais}
                  onChange={(e) => setModal((m) => ({ ...m, pais: e.target.value }))}
                  className={selectCls}
                >
                  {PAISES.map((p) => (
                    <option key={p} value={p}>
                      {BANDERA(p)} {p}
                    </option>
                  ))}
                </select>
              </label>

              {modal.editando && (
                <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                  <span>Estado</span>
                  <select
                    value={modal.estado}
                    onChange={(e) => setModal((m) => ({ ...m, estado: e.target.value }))}
                    className={selectCls}
                  >
                    <option value="Activo">🟢 Activo</option>
                    <option value="Inactivo">⚪ Inactivo</option>
                  </select>
                </label>
              )}

              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <Button variant="outline" size="md" onClick={cerrarModal}>
                  Cancelar
                </Button>
                <Button variant="success" size="md" onClick={() => void guardar()} disabled={guardando}>
                  {guardando ? "Guardando…" : "💾 Guardar"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ToastHost />
    </section>
  );
}

export default HipodromosModule;