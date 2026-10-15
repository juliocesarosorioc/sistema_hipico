"use client";

/**
 * Selector de grupo para el super administrador.
 *
 * La frontera real del aislamiento es el RLS de la base: un usuario con grupo
 * solo ve su grupo, quiera o no. Este control es la otra mitad que pidió el
 * dueño —"que josorio pueda ver todos los grupos o filtrar por grupo"—: cambia
 * qué grupo se está mirando y recarga para que TODAS las pantallas vuelvan a
 * leer con ese filtro.
 *
 * No se dibuja para quien no ve todos los grupos (nadie más lo necesita, y
 * enseñarle un selector que no cambia nada sería peor que no tenerlo).
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { listarGruposVenta, type GrupoVenta } from "@/lib/grupos";
import { limpiarCacheClientes } from "@/lib/clientes";

export function SelectorGrupo() {
  const veTodos = useAuthStore((s) => s.veTodosLosGrupos);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const setGrupoActivo = useAuthStore((s) => s.setGrupoActivo);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);

  useEffect(() => {
    if (!veTodos) return;
    let vivo = true;
    // Best-effort: si la lista de grupos no se puede leer, el selector sigue
    // mostrando "Todos los grupos" y no rompe la barra.
    listarGruposVenta()
      .then((g) => {
        if (vivo) setGrupos(g);
      })
      .catch(() => {
        /* sin grupos: queda solo "Todos" */
      });
    return () => {
      vivo = false;
    };
  }, [veTodos]);

  if (!veTodos) return null;

  const cambiar = (valor: string) => {
    setGrupoActivo(valor || null);
    // Las pantallas ya cargaron con el filtro anterior: la recarga es la forma
    // más simple (y sin fugas) de que todas relean. El grupo elegido queda
    // guardado en localStorage, así que sobrevive a la recarga.
    limpiarCacheClientes();
    window.location.reload();
  };

  return (
    <label
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-bold text-slate-700"
      title="Ver todos los grupos o filtrar por uno"
    >
      <span aria-hidden="true">🗂️</span>
      <span className="hidden sm:inline">Grupo</span>
      <select
        value={grupoActivo ?? ""}
        onChange={(e) => cambiar(e.target.value)}
        className="max-w-[10rem] bg-transparent text-xs font-bold text-slate-700 outline-none"
        aria-label="Grupo que se está mirando"
      >
        <option value="">Todos los grupos</option>
        {grupos.map((g) => (
          <option key={String(g.id)} value={String(g.id)}>
            {g.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SelectorGrupo;
