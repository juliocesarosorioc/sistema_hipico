import { useEffect } from "react";
import { create } from "zustand";
import { listarHipodromos, type OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { marcarLogosActualizados } from "@/shared/lib/logos";

type Estado = {
  /** Catálogo de hipódromos ACTIVOS (estado='Activo') para todos los selectores. */
  activos: OpcionHipodromo[];
  /** Contador de invalidación: cada bump obliga a los selectores a recargar. */
  version: number;
  /**
   * Versión de LOGOS: cambia cuando se carga/actualiza el logo de un hipódromo
   * (o de un grupo). Los componentes que pintan logos la miran para volver a
   * renderizar con el logo nuevo al instante, sin recargar la página.
   */
  versionLogos: number;
  setActivos: (lista: OpcionHipodromo[]) => void;
  /** Invalida el caché → los selectores montados recargan (borrado/desactivado al instante). */
  invalidar: () => void;
  /**
   * Marca los logos como actualizados: bumpea `versionLogos` y avanza la marca
   * global de cache-busting. Lo llama el guardado/limpieza de un logo.
   */
  bumpLogos: () => void;
};

export const useHipodromosStore = create<Estado>((set) => ({
  activos: [],
  version: 0,
  versionLogos: 0,
  setActivos: (lista) => set({ activos: lista }),
  invalidar: () => set((s) => ({ version: s.version + 1 })),
  bumpLogos: () =>
    set(() => {
      // Avanza la marca global (para `conCacheBust` en los `<img>`) y sube la
      // versión de logos que leen los componentes. NO toca `version` (esa es la
      // invalidación de selectores del CRUD, otra cosa).
      const marca = marcarLogosActualizados();
      return { versionLogos: marca };
    }),
}));

/**
 * Catálogo OPERATIVO de hipódromos para los selectores (Marcas, Tablas, Gestión,
 * Dupletas, Taquilla): solo 'Activo' y sin baja lógica.
 *
 * Ya no hay lista fija de nombres: entra todo lo registrado en la base cuyo
 * `estado` sea Activo, y un hipódromo suspendido, inactivo o archivado sale de
 * aquí al instante en que el módulo Hipódromos lo cambia. La lista se recarga
 * al montar, en cada invalidación del CRUD y cuando se actualiza un logo
 * (evento global `logos-updated`), para que el logo recién cargado aparezca sin
 * recargar la página.
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

  // Propagación reactiva: cualquier ventana que cargue un logo emite
  // `logos-updated`; acá se relee el catálogo para tener los `logo_url` frescos.
  useEffect(() => {
    const onLogos = () => {
      listarHipodromos().then((lista) => useHipodromosStore.getState().setActivos(lista));
    };
    window.addEventListener("logos-updated", onLogos);
    return () => window.removeEventListener("logos-updated", onLogos);
  }, []);

  return activos;
}

/**
 * Hook de propagación de logos para componentes que NO usan el catálogo pero
 * pintan el logo de un hipódromo o de un grupo (cabeceras, reportes, tarjetas).
 * Devuelve un contador que cambia cuando alguien actualiza un logo; usalo como
 * dependencia de tu relectura (o del `src` con `conCacheBust`).
 *
 * La suscripción al evento global vive UNA sola vez (ver `conectarLogos`), así
 * que varios componentes leyendo la versión no multiplican los renders.
 */
export function useVersionLogos(): number {
  useEffect(() => {
    conectarLogos();
  }, []);
  // Realtime cross-device: un logo cargado en otra PC/ventana llega por acá.
  useRealtimeLogos();
  return useHipodromosStore((s) => s.versionLogos);
}

/**
 * Conecta (una sola vez) el evento global `logos-updated` con el store:
 * cuando cualquier ventana carga o quita un logo, la versión sube y todos los
 * componentes que la leen se vuelven a pintar. Idempotente.
 */
let logosConectados = false;
export function conectarLogos(): void {
  if (logosConectados || typeof window === "undefined") return;
  logosConectados = true;
  window.addEventListener("logos-updated", () => {
    useHipodromosStore.getState().bumpLogos();
  });
}

/* ──────────────────────── REALTIME CROSS-DEVICE DE LOGOS ───────────────────
 * El evento `logos-updated` avisa DENTRO de la pestaña que cargó el logo. Pero
 * un logo cambiado desde OTRO navegador, otra PC o el celular del dueño no
 * emitía nada acá: las demás pantallas seguían mostrando el logo viejo hasta
 * recargar.
 *
 * Esta suscripción escucha las DOS tablas que guardan logos (`hipodromos` y
 * `grupos_venta`) por `postgres_changes` y, ante cualquier alta/edición/baja,
 * bumpea la versión de logos: es exactamente lo que hace el evento local, así
 * que todos los `<LogoDisplay>` / cabeceras de reporte se repintan solos.
 *
 * Una sola suscripción por pestaña, levantada por el PRIMER consumidor y bajada
 * por el último (ref-count), igual que `useRealtimeCarreras`. Requiere que las
 * tablas estén en la publicación `supabase_realtime` (sql/realtime_logos.sql);
 * sin eso, no pasa nada y queda el refresco local de siempre.
 */
let canalLogos: { unsubscribe: () => void } | null = null;
let oyentesLogos = 0;
let conectandoLogos = false;

async function conectarRealtimeLogos(): Promise<void> {
  if (canalLogos || conectandoLogos) return;
  conectandoLogos = true;
  try {
    const { supabase } = await import("@/core/supabase");
    if (!supabase || canalLogos) return;
    canalLogos = supabase
      .channel("logos-hipodromos-grupos")
      .on("postgres_changes", { event: "*", schema: "public", table: "hipodromos" }, () => {
        useHipodromosStore.getState().bumpLogos();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "grupos_venta" }, () => {
        useHipodromosStore.getState().bumpLogos();
      })
      .subscribe();
  } catch {
    // Sin realtime (publicación no aplicada o red): queda el evento local.
    canalLogos = null;
  } finally {
    conectandoLogos = false;
  }
}

function desconectarRealtimeLogos(): void {
  if (!canalLogos) return;
  const canal = canalLogos;
  canalLogos = null;
  try {
    canal.unsubscribe();
  } catch {
    /* noop */
  }
}

/**
 * Mantiene viva UNA suscripción realtime a los logos mientras haya pantallas que
 * los pinten. Es lo que hace que un logo cargado en otra PC/ventana aparezca al
 * instante, sin recargar.
 */
export function useRealtimeLogos(): void {
  useEffect(() => {
    oyentesLogos += 1;
    void conectarRealtimeLogos();
    return () => {
      oyentesLogos = Math.max(0, oyentesLogos - 1);
      if (oyentesLogos === 0) desconectarRealtimeLogos();
    };
  }, []);
}

