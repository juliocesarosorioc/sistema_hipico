"use client";

import {
  candidatosAutorizar,
  etiquetaModoVisibilidad,
  gruposAutorizadosDe,
  modoVisibilidad,
  type GrupoVisibilidad,
} from "@/features/grupos/lib/visibilidad-principal";

/**
 * ============================================================================
 * PANEL 🌐 VISIBILIDAD DE JUGADAS DEL GRUPO PRINCIPAL
 * ============================================================================
 * Se muestra SOLO cuando el grupo que se edita es el principal. Dos modalidades:
 *
 *   Toggle 1 · Visible para TODOS los usuarios/grupos de la plataforma.
 *   Toggle 2 · Seleccionar grupos autorizados (solo si el Toggle 1 está OFF).
 *
 * Regla acordada: si el Toggle 1 está encendido, la lista se deshabilita porque
 * ya no aporta (todos ven). El modo resultante se resume con un rótulo.
 *
 * Es presentacional/puro: el estado lo tiene el modal (`GruposModule`) para que
 * el guardado del grupo lo persista junto al resto de la edición.
 * ============================================================================
 */

export type PanelVisibilidadProps = {
  /** Grupo principal que se está editando. */
  principal: GrupoVisibilidad;
  /** Todos los grupos de la plataforma (para el selector múltiple). */
  grupos: ReadonlyArray<GrupoVisibilidad & { activo?: boolean | null }>;
  /** Toggle 1. */
  global: boolean;
  /** Toggle 2 (ids autorizados). */
  autorizados: ReadonlyArray<string | number>;
  onGlobal: (v: boolean) => void;
  onAutorizados: (ids: string[]) => void;
};

export function PanelVisibilidadPrincipal({
  principal,
  grupos,
  global,
  autorizados,
  onGlobal,
  onAutorizados,
}: PanelVisibilidadProps) {
  const efectivos = global ? [] : autorizados.map((v) => String(v));
  const modo = modoVisibilidad({
    ...principal,
    visibilidad_global_principal: global,
    grupos_autorizados_ver_principal: efectivos,
  });

  const candidatos = candidatosAutorizar(grupos, principal.id);

  const alternar = (id: string, marcar: boolean) => {
    const set = new Set(efectivos);
    if (marcar) set.add(id);
    else set.delete(id);
    // Conserva el orden de la lista de grupos visible.
    onAutorizados(candidatos.map((g) => String(g.id)).filter((x) => set.has(x)));
  };

  return (
    <div className="space-y-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-wider text-indigo-800">
          🌐 Visibilidad de Jugadas del Grupo Principal
        </span>
        <span className="rounded-lg bg-indigo-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
          {etiquetaModoVisibilidad(modo)}
        </span>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs font-bold text-slate-700">
        <input
          type="checkbox"
          checked={global}
          onChange={(e) => onGlobal(e.target.checked)}
          className="mt-0.5 rounded accent-indigo-600"
        />
        <span>
          Visible para <b>TODOS</b> los usuarios/grupos de la plataforma
          <span className="block font-normal text-slate-500">
            Si está encendido, todos ven las jugadas del principal y la lista de abajo se ignora.
          </span>
        </span>
      </label>

      <div className={global ? "opacity-40" : ""}>
        <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-600">
          Grupos autorizados a ver las jugadas del principal
        </div>
        {global ? (
          <p className="text-[11px] italic text-slate-500">
            Deshabilitado: con la visibilidad global activa, todos los grupos ya ven al principal.
          </p>
        ) : candidatos.length === 0 ? (
          <p className="text-[11px] italic text-slate-500">No hay otros grupos para autorizar.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {candidatos.map((g) => {
              const id = String(g.id);
              const marcado = gruposAutorizadosDe({
                id: g.id,
                grupos_autorizados_ver_principal: efectivos,
              }).includes(id);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={global}
                    onChange={(e) => alternar(id, e.target.checked)}
                    className="rounded accent-indigo-600"
                  />
                  <span className="truncate" title={String(g.nombre ?? "")}>
                    {String(g.nombre ?? "SIN NOMBRE")}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default PanelVisibilidadPrincipal;
