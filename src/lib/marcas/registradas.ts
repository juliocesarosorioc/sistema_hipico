/**
 * MODULO MARCAS — validacion contra la CARRERA REGISTRADA (logica PURA).
 *
 * Sin Supabase, sin React, sin I/O: se puede correr en un test y en el modal.
 *
 * De donde sale la informacion: la configuracion de Marcas NO se inventa, sale
 * de las carreras ya registradas en `resultados_carreras`, que es la lista real
 * de caballos que corren. El modulo hípico (Ejemplares, Gaceta y Carreras →
 * Carreras del Día) las registra con `listarCarrerasCentrales`, que ya normaliza
 * cada ejemplar y resuelve el retiro contra la lista central de la carrera.
 * Este archivo solo consume ese tipo canonico: no hay una segunda via de datos.
 *
 * Eso permite marcar y bloquear solo caballos que REALMENTE corren, en vez de
 * escribir "1/2/3/4/5" a ciegas y descubrir el error cuando la caja no
 * encuentra al rival.
 *
 * OJO con el resultado: registrar una carrera no es terminarla. El orden de
 * llegada lo carga `club_registrar_orden_llegada` al cerrar la carrera.
 */

import type { EjemplarCarreraCentral } from "@/lib/carreras/central";

/** Indice numero -> ejemplar, para validar marcas contra los participantes. */
export function indicePorNumero(caballos: EjemplarCarreraCentral[]): Map<string, EjemplarCarreraCentral> {
  return new Map(caballos.map((c) => [String(c.numero).trim(), c]));
}

/** "5 · SECRETARIAT" para las etiquetas del modal. */
export function etiquetaCaballo(c: EjemplarCarreraCentral): string {
  const n = String(c.numero).trim();
  return c.nombre ? `${n} · ${c.nombre}` : n;
}

export type RevisionConfig = {
  /** Marcas que no estan en la carrera registrada. */
  marcasInvalidas: string[];
  /** NV que no estan en la carrera registrada. */
  nvInvalidos: string[];
  /** Numeros repetidos dentro de las marcas. */
  marcasRepetidas: string[];
  /** Caballos que estan a la vez como marca y como NV. */
  marcadosYNoVale: string[];
  /** Marcas marcadas sobre un ejemplar retirado. */
  marcasRetiradas: string[];
  /** Debutantes que no estan en la carrera registrada. */
  debutantesInvalidos: string[];
  /** Caballos que estan a la vez como marca y como debutante. */
  marcadosYDebutante: string[];
  /** La carrera no tiene ejemplares registrados: no se puede configurar. */
  carreraVacia: boolean;
  valida: boolean;
  mensaje?: string;
};

/**
 * Valida la configuracion de Marcas contra los ejemplares REALES de la carrera
 * registrada. Da feedback inmediato en el modal, y `club_vender_marca` repite
 * las mismas comprobaciones: la UI no es la frontera de confianza, asi que una
 * caja con la pantalla abierta antes de la inscripcion no debe poder vender
 * contra un rival que no participa.
 *
 * `debutantes` es opcional para no romper a los llamadores que todavia no lo
 * pasan.
 */
export function revisarConfig(
  caballos: EjemplarCarreraCentral[],
  marcas: string[],
  nv: string[],
  debutantes: string[] = []
): RevisionConfig {
  const idx = indicePorNumero(caballos);
  const carreraVacia = idx.size === 0;

  const marcasRepetidas = marcas.filter((m, i) => marcas.indexOf(m) !== i);
  const marcasInvalidas = marcas.filter((m) => !idx.has(m));
  const nvInvalidos = nv.filter((n) => !idx.has(n));
  const marcadosYNoVale = marcas.filter((m) => nv.includes(m));
  const marcasRetiradas = marcas.filter((m) => idx.get(m)?.retirado === true);
  const debutantesInvalidos = debutantes.filter((d) => !idx.has(d));
  const marcadosYDebutante = marcas.filter((m) => debutantes.includes(m));

  const problemas: string[] = [];
  if (carreraVacia) problemas.push("la carrera no tiene ejemplares registrados");
  if (marcasRepetidas.length) problemas.push(`marcas repetidas: ${marcasRepetidas.join(", ")}`);
  if (marcasInvalidas.length) problemas.push(`marcas que no corren: ${marcasInvalidas.join(", ")}`);
  if (nvInvalidos.length) problemas.push(`NV que no corren: ${nvInvalidos.join(", ")}`);
  if (marcadosYNoVale.length) problemas.push(`a la vez marca y NV: ${marcadosYNoVale.join(", ")}`);
  if (marcasRetiradas.length) problemas.push(`marcas retiradas: ${marcasRetiradas.join(", ")}`);
  // Se validan siempre, tenga el switch en true o en false: un numero mal
  // escrito es un error de tipeo ahora, y si solo se mirara con el switch
  // apagado pasaria desapercibido hasta el dia que lo apaguen.
  if (debutantesInvalidos.length)
    problemas.push(`debutantes que no corren: ${debutantesInvalidos.join(", ")}`);
  if (marcadosYDebutante.length)
    problemas.push(`a la vez marca y debutante: ${marcadosYDebutante.join(", ")}`);

  return {
    marcasInvalidas,
    nvInvalidos,
    marcasRepetidas,
    marcadosYNoVale,
    marcasRetiradas,
    debutantesInvalidos,
    marcadosYDebutante,
    carreraVacia,
    valida: problemas.length === 0,
    mensaje: problemas.length ? problemas.join("; ") : undefined,
  };
}

/**
 * Ejemplares que todavia se pueden marcar: los que corren y no estan usados.
 * Es la lista que ofrece el desplegable de "agregar marca" del modal.
 */
export function candidatosAMarca(
  caballos: EjemplarCarreraCentral[],
  marcas: string[],
  nv: string[]
): EjemplarCarreraCentral[] {
  const usados = new Set([...marcas, ...nv]);
  return caballos.filter((c) => !usados.has(String(c.numero).trim()));
}

/** Atajo: un ejemplar concreto de la carrera. */
export function buscarEjemplar(
  caballos: EjemplarCarreraCentral[],
  numero: string
): EjemplarCarreraCentral | null {
  return indicePorNumero(caballos).get(String(numero ?? "").trim()) ?? null;
}
