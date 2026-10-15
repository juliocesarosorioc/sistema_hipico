import { useEffect } from "react";
import { create } from "zustand";
import { listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";

type Estado = {
  /** Catálogo de hipódromos ACTIVOS (estado='Activo') para todos los selectores. */
  activos: OpcionHipodromo[];
  /** Contador de invalidación: cada bump obliga a los selectores a recargar. */
  version: number;
  setActivos: (lista: OpcionHipodromo[]) => void;
  /** Invalida el caché → los selectores montados recargan (borrado/desactivado al instante). */
  invalidar: () => void;
};

export const useHipodromosStore = create<Estado>((set) => ({
  activos: [],
  version: 0,
  setActivos: (lista) => set({ activos: lista }),
  invalidar: () => set((s) => ({ version: s.version + 1 })),
}));

/**
 * Catálogo OPERATIVO de hipódromos para los selectores (Marcas, Tablas, Gestión,
 * Dupletas, Taquilla): solo 'Activo' y sin baja lógica.
 *
 * Ya no hay lista fija de nombres: entra todo lo registrado en la base cuyo
 * `estado` sea Activo, y un hipódromo suspendido, inactivo o archivado sale de
 * aquí al instante en que el módulo Hipódromos lo cambia. La lista se recarga
 * al montar y en cada invalidación del CRUD.
 */
export function useHipodromosActivos(): OpcionHipodromo[] {
  const activos = useHipodromosStore((s) => s.activos);
  const version = useHipodromosStore((s) => s.version);

  useEffect(() => {
    let vivo = true;
    listarHipodromos().then((lista) => {
      if (vivo) useHipodromosStore.getState().setActivos(lista);
    });
    return () => {
      vivo = false;
    };
  }, [version]);

  return activos;
}