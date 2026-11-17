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
 * Para el resto de la sesión (administradores y operadores de un grupo) el
 * control no permite cambiar nada: solo informa el tenant con el que entró,
 * bajo el texto "Viendo como: [Grupo]".
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { limpiarCacheClientes } from "@/features/clientes/lib/clientes";

export function SelectorGrupo() {
  const veTodos = useAuthStore((s) => s.veTodosLosGrupos);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const modoOperador = useAuthStore((s) => s.modoOperador);
  const perfiles = useAuthStore((s) => s.perfiles);
  const miGrupoId = useAuthStore((s) => s.grupoId);
  const nombreGrupo = useAuthStore((s) => s.grupoNombre);
  const tieneGrupoAsignado = !esPrincipal && Boolean(miGrupoId && miGrupoId.trim() !== "");
  const esOperador = modoOperador || perfiles.includes("OPERADOR");
  const puedeCambiar = veTodos && !esOperador && !tieneGrupoAsignado;
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const setGrupoActivo = useAuthStore((s) => s.setGrupoActivo);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);

  useEffect(() => {
    if (!puedeCambiar) return;
    let vivo = true;
    const cargar = () => {
      listarGruposVenta()
        .then((g) => {
          if (!vivo) return;
          const gruposValidos = g.filter((x) => x.activo !== false);
          setGrupos(gruposValidos);
          // Solo si el grupo activo seleccionado ya no existe en la base, volver a todos
          if (gruposValidos.length > 0 && grupoActivo) {
            const actualExiste = gruposValidos.some((x) => String(x.id) === String(grupoActivo));
            if (!actualExiste) {
              setGrupoActivo(null);
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
  }, [puedeCambiar, grupoActivo, setGrupoActivo]);

  const nombreFijo =
    String(nombreGrupo ?? "").trim() ||
    grupos.find((g) => String(g.id) === String(miGrupoId))?.nombre ||
    "Todos los grupos";

  if (!puedeCambiar && !tieneGrupoAsignado) return null;

  const cambiar = (valor: string) => {
    const v = valor && valor.trim() !== "" ? valor.trim() : null;
    setGrupoActivo(v);
    limpiarCacheClientes();
    window.location.reload();
  };

  if (!puedeCambiar) {
    return (
      <span
        className="inline-flex h-9 max-w-[16rem] items-center gap-1.5 truncate rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-bold text-slate-800"
        title="Grupo de la sesión"
      >
        <span aria-hidden="true">👁️</span>
        <span>Viendo como: [{nombreFijo}]</span>
      </span>
    );
  }

  return (
    <label
      className="inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-bold text-slate-800"
      title="Grupo activo seleccionado"
    >
      <span aria-hidden="true">👁️</span>
      <span className="shrink-0">Viendo como:</span>
      <select
        value={grupoActivo ?? ""}
        onChange={(e) => cambiar(e.target.value)}
        className="max-w-[7.5rem] min-w-0 truncate bg-transparent text-xs font-black text-slate-900 outline-none cursor-pointer sm:max-w-[9.5rem] 2xl:max-w-[13rem]"
        aria-label="Grupo activo seleccionado"
      >
        <option value="" className="bg-white text-slate-900 font-bold">
          Todos los grupos
        </option>
        {grupos.map((g) => (
          <option key={String(g.id)} value={String(g.id)} className="bg-white text-slate-900 font-bold">
            [{g.nombre}] {g.es_principal ? "★" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SelectorGrupo;
