"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import {
  capacidadesDeRuta,
  esRolOperadorExclusivo,
  esRutaPermitidaOperador,
  rutaPermitida,
  RUTAS_PROTEGIDAS,
} from "@/features/seguridad/lib/capacidades";

type Props = {
  /**
   * Capacidad requerida para ver la ruta. Lista = se exigen TODAS.
   *
   * Si se omite, se deduce sola del REGISTRO MAESTRO según la ruta actual
   * (mismo criterio que src/middleware.ts). Es lo deseable: la página no
   * repite la lista de capacidades y no puede quedar desincronizada.
   */
  permiso?: string | string[];
  /**
   * Basta con poseer UNO de estos. Hace falta porque hay rutas con lectura y
   * escritura sobre el mismo módulo: `/clientes` se abre con
   * `clientes:ruta_clientes` (para ver la cartera) o con
   * `clientes:btn_editar` (además de poder crear/editar/borrar). Si se pasa,
   * `permiso` se ignora.
   */
  algunaDe?: string | string[];
  children: ReactNode;
};

/** Normaliza `string | string[] | undefined` a lista. */
const aLista = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Guardia de RUTA (defensa en profundidad de src/middleware.ts).
 * Si el usuario actual no tiene el permiso, redirige a /dashboard sin
 * renderizar el contenido (evita el parpadeo de la página desautorizada).
 */
export function RutaProtegida({ permiso, algunaDe, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const inicializada = useAuthStore((s) => s.inicializada);
  const permisos = useAuthStore((s) => s.permisos);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const perfiles = useAuthStore((s) => s.perfiles);
  const modoOperador = useAuthStore((s) => s.modoOperador);
  const esOperadorRestringido = esRolOperadorExclusivo(perfiles, modoOperador);

  // Sin prop, la capacidad sale del registro maestro para esta ruta. Con prop,
  // la prop manda. `algunaDe` tiene prioridad sobre `permiso` (ver la doc).
  const exigidas = useMemo(() => {
    if (algunaDe !== undefined) return aLista(algunaDe);
    if (permiso !== undefined) return aLista(permiso);
    return capacidadesDeRuta(pathname);
  }, [algunaDe, permiso, pathname]);

  // Se calcula en el render (no en un efecto) para que el contenido nunca
  // llegue a pintarse antes de decidir: antes había un `permitido === null`
  // que devolvía null, pero con `esPrincipal` sin consultar, un usuario sin la
  // ruta podía ver los primeros fotogramas.
  const pendientes = !inicializada;
  const set = new Set(permisos);
  // Sin props, la decisión la toma `rutaPermitida`, la MISMA función que corre
  // en el middleware: las dos capas no pueden discrepar. Una ruta no
  // registrada se NIEGA. Con props, la página manda: lista = se exigen todas,
  // `algunaDe` = basta una.
  const cumple =
    permiso === undefined && algunaDe === undefined
      ? rutaPermitida(pathname, set)
      : exigidas.length === 0
        ? true
        : algunaDe !== undefined
          ? exigidas.some((p) => set.has(p))
          : exigidas.every((p) => set.has(p));
  const permitido = esOperadorRestringido
    ? esRutaPermitidaOperador(pathname)
    : esPrincipal || cumple;

  useEffect(() => {
    if (pendientes || permitido) return;
    if (esOperadorRestringido) {
      router.replace("/apuestas");
      return;
    }
    // Fallback: el destino tiene que ser una ruta a la que el usuario sí pueda
    // llegar. `/inicio` exige `general:ruta_inicio`, que no todos los tipos
    // tienen; mandar ahí a ciegas podía dejar al usuario en un ciclo de
    // redirecciones. Se busca la primera ruta registrada que sí posea.
    //
    // La decisión la toma `rutaPermitida` —la MISMA función que corre el
    // middleware— en vez de comparar capacidades a mano: así el destino
    // respeta también las puertas declaradas con `algunas` (basta con una).
    //
    // `/dashboard` NO va primero: es un alias que redirige a `/inicio`, así que
    // usarlo de destino solo agrega un salto intermedio sin sentido.
    const candidatas = ["/inicio", ...RUTAS_PROTEGIDAS];
    const destino = candidatas.find((r) => rutaPermitida(r, set));
    router.replace(destino ?? "/login");
  }, [pendientes, permitido, router, permisos]);

  if (pendientes) return null;
  if (!permitido) return null;

  return <>{children}</>;
}

export default RutaProtegida;