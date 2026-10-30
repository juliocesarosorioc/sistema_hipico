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
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { limpiarCacheClientes } from "@/features/clientes/lib/clientes";

export function SelectorGrupo() {
  const veTodos = useAuthStore((s) => s.veTodosLosGrupos);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const setGrupoActivo = useAuthStore((s) => s.setGrupoActivo);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);

  useEffect(() => {
    if (!veTodos) return;
    let vivo = true;
    const cargar = () => {
      listarGruposVenta()
        .then((g) => {
          if (!vivo) return;
          const gruposValidos = g.filter((x) => x.activo !== false);
          setGrupos(gruposValidos);
          // Si no hay grupo activo seleccionado o el actual no es válido, seleccionar el grupo principal
          if (gruposValidos.length > 0) {
            const actualExiste = gruposValidos.some((x) => String(x.id) === String(grupoActivo));
            if (!grupoActivo || !actualExiste) {
              const principal = gruposValidos.find((x) => x.es_principal) || gruposValidos[0];
              setGrupoActivo(String(principal.id));
            }
          }
        })
        .catch(() => {
          /* sin grupos */
        });
    };

    cargar();
    window.addEventListener("grupos:actualizados", cargar);
    return () => {
      vivo = false;
      window.removeEventListener("grupos:actualizados", cargar);
    };
  }, [veTodos, grupoActivo, setGrupoActivo]);

  if (!veTodos) return null;

  const cambiar = (valor: string) => {
    const v = valor && valor.trim() !== "" ? valor.trim() : null;
    if (!v) return;
    setGrupoActivo(v);
    limpiarCacheClientes();
    window.location.reload();
  };

  return (
    <label
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-bold text-slate-800"
      title="Grupo activo seleccionado"
    >
      <span aria-hidden="true">📁</span>
      <span className="hidden sm:inline">Grupo:</span>
      <select
        value={grupoActivo ?? (grupos[0] ? String(grupos[0].id) : "")}
        onChange={(e) => cambiar(e.target.value)}
        className="max-w-[13rem] bg-transparent text-xs font-black text-slate-900 outline-none cursor-pointer"
        aria-label="Grupo activo seleccionado"
      >
        {grupos.map((g) => (
          <option key={String(g.id)} value={String(g.id)} className="bg-white text-slate-900 font-bold">
            {g.nombre} {g.es_principal ? "★" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SelectorGrupo;
