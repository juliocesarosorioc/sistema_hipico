"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";
import { Flag } from "@/components/ui/BanderaPais";
import {
  listarHipodromos,
  crearHipodromo,
  actualizarHipodromo,
  eliminarHipodromo,
  reactivarHipodromo,
  activarTodosHipodromos,
} from "@/lib/hipodromos/servicio";
import {
  estaBorrado,
  etiquetaEstado,
  formatearNombre,
  levenshteinNorm,
  normalizarEstado,
  PAISES,
  type Hipodromo,
} from "@/lib/hipodromos/tipos";
import { useHipodromosStore } from "@/store/useHipodromosStore";
import { useRegistroCentral } from "@/store/useRegistroCentral";

type FormModal = { abierta: boolean; editando: Hipodromo | null; nombre: string; pais: string; estado: string };

const inicialModal = (editando: Hipodromo | null): FormModal => ({
  abierta: !!editando,
  editando,
  nombre: editando?.nombre ?? "",
  pais: (editando?.pais || "VE").toUpperCase(),
  estado: normalizarEstado(editando?.estado),
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
  const [archivados, setArchivados] = useState<Hipodromo[]>([]);
  const [verArchivados, setVerArchivados] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [local, setLocal] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal] = useState<FormModal>(() => inicialModal(null));
  const [guardando, setGuardando] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const invalidarSelectores = useCallback(() => {
    useHipodromosStore.getState().invalidar();
    // También el registro central: Marcas, Gestión, Tablas y Dupletas leen el
    // catálogo de ahí. Sin esto, un alta o baja se reflejaba en unos módulos y
    // en otros seguía el hipódromo fantasma. Se invalida SOLO el catálogo
    // (`invalidarHipodromos`, no `invalidar`): renombrar o dar de baja un
    // hipódromo no cambia ninguna carrera, y `invalidar` dispararía una ráfaga
    // de consultas a la matriz `carreras` en todos los módulos abiertos.
    useRegistroCentral.getState().invalidarHipodromos();
  }, []);

  const refrescar = useCallback(async () => {
    // Los archivados se piden con `incluirBorrados`: vienen de la misma tabla
    // (baja lógica) pero fuera de los selectores, para poder reactivarlos.
    const res = await listarHipodromos({ incluirBorrados: true });
    const todos = res.data;
    setHipodromos(todos.filter((h) => !estaBorrado(h)));
    setArchivados(todos.filter(estaBorrado));
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

  /**
   * Suspender no es un borrado disfrazado: abre el MISMO modal de edición con el
   * estado en 'Suspendido', para que el operador vea exactamente qué va a pasar
   * (deja de ofrecerse, pero el historial sigue) y pueda cancelar.
   */
  const abrirSuspender = (h: Hipodromo) => {
    setModal({ ...inicialModal(h), estado: "Suspendido" });
    toast(`Suspendiendo "${h.nombre}": dejará de ofrecerse en los selectores. Nada se borra.`, "info");
  };

  const cerrarModal = () => setModal(inicialModal(null));

  const guardar = async () => {
    const nombre = formatearNombre(modal.nombre);
    if (!nombre) return toast("Escriba el nombre del hipódromo.", "warning");

    // Validación fuzzy (misma del legacy): evita cuasi-duplicados por país.
    // Los archivados NO cuentan como duplicado: si el nombre coincide con uno
    // dado de baja, el alta lo REACTIVA en vez de bloquearse.
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
    toast(
      res.reactivado
        ? `♻️ Hipódromo "${nombre}" reactivado: conserva todo su historial.`
        : modal.editando
          ? `✅ Hipódromo "${nombre}" actualizado.`
          : `✅ Hipódromo "${nombre}" creado.`,
      "success"
    );
    cerrarModal();
    invalidarSelectores();
    void refrescar();
  };

  /**
   * Baja LÓGICA: la fila queda archivada, no se borra. Todo lo ya registrado con
   * ese nombre (carreras, marcas, tablas, tickets, liquidaciones) sigue ahí, y
   * `reactivarHipodromo` la devuelve.
   */
  const eliminar = async (h: Hipodromo) => {
    if (
      !window.confirm(
        `¿Archivar el hipódromo "${h.nombre}"?\n\n` +
          `Deja de ofrecerse en Marcas, Tablas, Gestión, Dupletas y Taquilla, pero ` +
          `NO se borra nada: las carreras, tablas y tickets con ese nombre quedan ` +
          `registrados. Podés reactivarlo cuando quieras desde "Archivados".`
      )
    )
      return;
    const res = await eliminarHipodromo(h.id);
    if (!res.ok) return toast(res.error ?? "Error al archivar.", "error");
    toast(`🗄️ Hipódromo "${h.nombre}" archivado. Su historial quedó registrado.`, "success");
    invalidarSelectores();
    void refrescar();
  };

  const reactivar = async (h: Hipodromo) => {
    const res = await reactivarHipodromo(h.id);
    if (!res.ok) return toast(res.error ?? "Error al reactivar.", "error");
    toast(`♻️ Hipódromo "${h.nombre}" reactivado.`, "success");
    invalidarSelectores();
    void refrescar();
  };

  /**
   * Reactiva una fila vigente que estaba Inactiva/Suspendida (no archivada):
   * basta con volver a 'Activo'. No toca `eliminado_en`, que ya está en NULL.
   */
  const activarUno = async (h: Hipodromo) => {
    const res = await actualizarHipodromo(h.id, { estado: "Activo" });
    if (!res.ok) return toast(res.error ?? "Error al activar.", "error");
    toast(`✅ Hipódromo "${h.nombre}" activo.`, "success");
    invalidarSelectores();
    void refrescar();
  };

  const activarTodos = async () => {
    const inactivos = hipodromos.filter((h) => normalizarEstado(h.estado) !== "Activo").length;
    if (inactivos === 0) return toast("Todos los hipódromos vigentes ya están activos.", "info");
    if (!window.confirm(`¿Activar ${inactivos} hipódromo(s) inactivos o suspendidos?\n\nLos archivados NO se tocan.`)) return;
    const res = await activarTodosHipodromos();
    if (!res.ok) return toast(res.error ?? "Error al activar.", "error");
    toast(`✅ ${res.activados ?? 0} hipódromo(s) activados.`, "success");
    invalidarSelectores();
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
            {hipodromos.length} vigentes · {archivados.length} archivados{local ? " · modo respaldo (sin conexión)" : " · sincronizado con Supabase"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="md" onClick={() => void activarTodos()} title="Poner en Activo todos los hipódromos vigentes">
            ⚡ Activar todos
          </Button>
          <Button variant="success" size="md" onClick={abrirNuevo}>
            ＋ Nuevo Hipódromo
          </Button>
        </div>
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
                const estado = normalizarEstado(h.estado);
                const activo = estado === "Activo";
                return (
                  <tr key={String(h.id)} className="transition-colors hover:bg-surfaceAlt">
                    <td className="px-4 py-2.5">
                      <p className="font-black uppercase tracking-wide text-slate-800">{h.nombre}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-slate-600">
                        <span className="text-base leading-none"><Flag nac={h.pais} size={14} withName={false} /></span>
                        {h.pais}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={etiquetaEstado(h).clase}>{etiquetaEstado(h).texto}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                      {h.fecha_creacion ? new Date(h.fecha_creacion).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => abrirEditar(h)}>
                          ✏️ Editar
                        </Button>
                        {activo ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void abrirSuspender(h)}
                            title="Dejar de ofrecer este hipódromo sin borrarlo"
                          >
                            ⏸️ Suspender
                          </Button>
                        ) : (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => void activarUno(h)}
                            title="Reactivar este hipódromo"
                          >
                            ♻️ Reactivar
                          </Button>
                        )}
                        <Button variant="danger" size="sm" onClick={() => void eliminar(h)} title="Archivar hipódromo (su historial queda registrado)">
                          🗄️
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

      {/* Archivados: bajas lógicas. Fuera de todos los selectores, con todo su
          historial enlazado al mismo id. Solo se van de aquí con "Reactivar"
          (o al volver a escribir el nombre en "Nuevo Hipódromo"). */}
      {archivados.length > 0 && (
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setVerArchivados((v) => !v)}
            className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-2.5 text-left"
          >
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">
              🗄️ Archivados ({archivados.length}) — no se ofrecen en el juego
            </span>
            <span className="text-[11px] font-black text-slate-400">{verArchivados ? "▲" : "▼"}</span>
          </button>
          {verArchivados && (
            <div className="divide-y divide-line/70">
              {archivados.map((h) => (
                <div key={String(h.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-black uppercase tracking-wide text-slate-500 line-through">{h.nombre}</p>
                    <p className="text-[10px] font-semibold text-slate-400">
                      {h.pais} · archivado {h.eliminado_en ? new Date(h.eliminado_en).toLocaleDateString("es-ES") : "—"} · su historial de
                      carreras, tablas y tickets sigue registrado
                    </p>
                  </div>
                  <Button variant="success" size="sm" onClick={() => void reactivar(h)} title="Reactivar con el mismo id y todo su historial">
                    ♻️ Reactivar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

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
                      <Flag nac={p} size={13} /> {p}
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
                    <option value="Activo">🟢 Activo — se ofrece en Marcas, Tablas, Gestión y Taquilla</option>
                    <option value="Inactivo">⚪ Inactivo — fuera de los selectores, sin archivarlo</option>
                    <option value="Suspendido">🟠 Suspendido — temporalmente fuera de los selectores</option>
                  </select>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Inactivo y Suspendido no se ofrecen en los selectores de juego, pero siguen en el catálogo y su historial queda
                    intacto. "Archivar" es la baja lógica: no aparece en ningún selector hasta reactivarlo.
                  </span>
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