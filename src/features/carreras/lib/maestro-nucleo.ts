/**
 * NÚCLEO PURO de la matriz de carreras — sin Supabase, sin React, sin alias.
 *
 * Vive aparte de `carreras/maestro.ts` por una razón concreta: este archivo se
 * puede correr en node y testear (`pruebas/carreras-maestro.test.ts`), mientras
 * `maestro.ts` importa el cliente de Supabase y no se puede ejecutar fuera del
 * navegador. Es el mismo corte que `remates/core.ts` vs `remates.ts`.
 *
 * Todo lo que decide el catálogo de carreras —cómo se lee una fila de la matriz,
 * cómo se sacan los retiros y de dónde sale el estado que ve la UI— se prueba
 * acá sin base de datos.
 */
// Relativo a propósito: este archivo se corre en node (tsx) y las pruebas no
// resuelven el alias `@/`. Es un hermano en la misma carpeta.
import { parsearRetirados, textoRetirados, normalizarRetirados } from "@/features/carreras/lib/retiros-nucleo";
import { claveHipodromo, numeroCarrera, claveCarrera } from "@/features/carreras/lib/claves";

/**
 * Ordena una lista de ejemplares por `numero` ASCENDENTE (comparando numérico,
 * no texto, para que C2 vaya antes que C10). Los números inválidos o vacíos van
 * al final, conservando entre sí su orden relativo (sort estable).
 *
 * Se aplica TANTO al escribir como al leer: así la pizarra y todas las carreras
 * de todos los módulos se muestran 1..n aunque la fuente (texto de la Gaceta,
 * Excel o extracción de la IA) haya llegado desordenada.
 */
export function ordenarPorNumero<E extends { numero?: string | number | null }>(lista: E[]): E[] {
  return [...lista].sort((a, b) => {
    const na = posicionNumerica(a.numero);
    const nb = posicionNumerica(b.numero);
    if (na !== nb) return na - nb;
    return String(a.numero ?? "").localeCompare(String(b.numero ?? ""));
  });
}

function posicionNumerica(numero: unknown): number {
  if (numero == null) return Number.MAX_SAFE_INTEGER;
  const s = String(numero).trim();
  const m = /^\s*(\d+)/.exec(s);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Ejemplar tal como lo entrega cada módulo. La IA y el programa usan
 *  `numero: string | number`; la matriz guarda el Nº como texto y
 *  `normalizarCaballos` lo resuelve al leer. */
export type EjemplarMatriz = {
  numero: string | number;
  nombre?: string | null;
  nacionalidad?: string | null;
  retirado?: boolean;
  jockey?: string | null;
  entrenador?: string | null;
  peso?: number | string | null;
  medicamento?: string | null;
  implementos?: string | null;
};

export type EjemplarCarreraCentral = {
  numero: string;
  nombre?: string | null;
  nacionalidad?: string | null;
  /** Retirado según la lista CENTRAL de la carrera. */
  retirado?: boolean;
  jockey?: string | null;
  entrenador?: string | null;
  peso?: number | string | null;
  medicamento?: string | null;
  implementos?: string | null;
};

/** Resultado embebido de la fila maestra (0 o 1 mientras la carrera no corrió). */
export type ResultadoDeCarrera = {
  ganadores?: unknown;
  orden_llegada?: unknown;
  dividendos?: unknown;
  retirado?: unknown;
  retirados?: unknown;
  aplicado_a_tablas?: unknown;
  premio_oficial?: unknown;
  premio_recalculado?: unknown;
};

export type FilaCarreraMaestro = {
  id?: string;
  fecha: string;
  hipodromo: string;
  hipodromo_id?: number | null;
  carrera: number;
  estado?: string | null;
  caballos?: unknown;
  retirados?: string | null;
  distancia?: string | null;
  superficie?: string | null;
  premio?: number | null;
  hora?: string | null;
origen?: string | null;
registrado_por?: string | null;
actualizado_por?: string | null;
verificado?: boolean | null;
verificado_por?: string | null;
verificado_at?: string | null;
invalidado_remate?: string | null;
  /** Ejemplares invalidados SOLO para Pollas (columna `invalidado_polla`). */
  invalidado_polla?: string | null;
  updated_at?: string | null;
  resultados_carreras?: ResultadoDeCarrera | ResultadoDeCarrera[] | null;
};

/** Fila que se escribe en la matriz. Obligatorios: hipódromo y Nº de carrera. */
export type EntradaCarrera = {
  fecha?: string;
hipodromo: string;
carrera: number | string;
estado?: string;
caballos?: EjemplarMatriz[] | null;
retirados?: string | null;
  invalidado_remate?: string | null;
  invalidado_polla?: string | null;
distancia?: string | null;
  superficie?: string | null;
  premio?: number | null;
  hora?: string | null;
  origen?: string;
  /**
   * FUSIONAR los ejemplares con los que ya están guardados, en vez de
   * reemplazarlos.
   *
   * Se usa en las cargas PARCIALES de gaceta: cuando se sube un lote que solo
   * trae algunas carreras (o una carrera leída a medias), la lista de
   * ejemplares de esa carrera tiene que QUEDAR ACUMULATIVA. Reemplazarla
   * borraba los ejemplares que el lote anterior sí había leído, y la carrera
   * se quedaba con la mitad del padrón.
   *
   * La fusión es por NÚMERO DE GUALDRAPA: el número identifica al ejemplar
   * dentro de la carrera, así que un ejemplar que cambia de nombre conserva
   * su número y se actualiza en vez de duplicarse.
   */
  fusionar_ejemplares?: boolean;
};

export type ResultadoMergeCarrera = {
  carrera: EntradaCarrera;
  cambio: boolean;
  ejemplaresCompletados: number;
  camposCompletados: string[];
};

const tieneDato = (valor: unknown): boolean =>
  valor !== null && valor !== undefined && String(valor).trim() !== "";

const nombreGenerico = (valor: unknown): boolean =>
  !tieneDato(valor) || /^(?:EJEMPLAR|CABALLO)\s*\d*$/i.test(String(valor).trim());

/** Enriquece una fila cargada sin reemplazar datos operativos ya existentes. */
export function fusionarCargaGaceta(
  existente: FilaCarreraMaestro,
  nueva: EntradaCarrera
): ResultadoMergeCarrera {
  const camposCompletados: string[] = [];
  const completarCampo = <T>(campo: string, anterior: T | null | undefined, propuesto: T | null | undefined): T | null | undefined => {
    if (!tieneDato(anterior) && tieneDato(propuesto)) {
      camposCompletados.push(campo);
      return propuesto;
    }
    return anterior;
  };

  const existentesPorNumero = new Map<string, EjemplarMatriz>();
  for (const raw of Array.isArray(existente.caballos) ? existente.caballos : []) {
    if (!raw || typeof raw !== "object") continue;
    const ejemplar = raw as EjemplarMatriz;
    const numero = String(ejemplar.numero ?? "").trim();
    if (numero && !existentesPorNumero.has(numero)) existentesPorNumero.set(numero, ejemplar);
  }
  let ejemplaresCompletados = 0;
  const nuevosPorNumero = new Map<string, EjemplarMatriz>();
  for (const raw of Array.isArray(nueva.caballos) ? nueva.caballos : []) {
    const numero = String(raw.numero ?? "").trim();
    if (!numero) continue;
    const previo = existentesPorNumero.get(numero);
    if (!previo) {
      nuevosPorNumero.set(numero, raw);
      ejemplaresCompletados++;
      camposCompletados.push(`Ejemplar #${numero}`);
      continue;
    }
    const caballo: EjemplarMatriz = { ...previo, numero };
    let cambio = false;
    const completar = <T>(campo: keyof EjemplarMatriz, valor: T | null | undefined, reemplazarGenerico = false) => {
      const anterior = caballo[campo];
      const falta = !tieneDato(anterior) || (reemplazarGenerico && nombreGenerico(anterior));
      if (falta && tieneDato(valor)) {
        (caballo as Record<string, unknown>)[campo] = valor;
        cambio = true;
        camposCompletados.push(`#${numero} ${String(campo)}`);
      }
    };
    completar("nombre", raw.nombre, true);
    completar("nacionalidad", raw.nacionalidad);
    completar("jockey", raw.jockey);
    completar("entrenador", raw.entrenador);
    completar("peso", raw.peso);
    completar("medicamento", raw.medicamento);
    completar("implementos", raw.implementos);
    caballo.retirado = previo.retirado === true || raw.retirado === true;
    if (cambio) ejemplaresCompletados++;
    nuevosPorNumero.set(numero, caballo);
  }
  for (const [numero, caballo] of existentesPorNumero) {
    if (!nuevosPorNumero.has(numero)) nuevosPorNumero.set(numero, caballo);
  }

  const caballoLista = [...nuevosPorNumero.values()];
  const distancia = completarCampo("distancia", existente.distancia, nueva.distancia);
  const hora = completarCampo("hora", existente.hora, nueva.hora);
  const superficie = completarCampo("superficie", existente.superficie, nueva.superficie);
  const premio = completarCampo("premio", existente.premio, nueva.premio);
  return {
    carrera: {
      ...nueva,
      fecha: existente.fecha,
      hipodromo: existente.hipodromo,
      carrera: existente.carrera,
      estado: existente.estado ?? nueva.estado,
      caballos: caballoLista,
      distancia: distancia ?? null,
      hora: hora ?? null,
      superficie: superficie ?? null,
      premio: premio ?? null,
      retirados: existente.retirados,
      invalidado_remate: existente.invalidado_remate,
      invalidado_polla: existente.invalidado_polla,
      origen: existente.origen ?? nueva.origen,
    },
    cambio: camposCompletados.length > 0,
    ejemplaresCompletados,
    camposCompletados,
  };
}

/** Carrera ya normalizada: lo que consume toda la plataforma. */
export type CarreraCatalogo = {
  id?: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
  caballos?: EjemplarCarreraCentral[];
  retirados?: string[];
  distancia?: string | null;
  superficie?: string | null;
  premio?: number | null;
  hora?: string | null;
estado?: string;
origen?: string | null;
registrado_por?: string | null;
actualizado_por?: string | null;
verificado?: boolean;
verificado_por?: string | null;
verificado_at?: string | null;
/** Ejemplares invalidados SOLO para Remates. No es lo mismo que retirados. */
  invalidados?: string[];
  /**
   * Ejemplares invalidados SOLO para Pollas.
   *
   * Va aparte de `invalidados` a propósito: el INV de Remates saca al ejemplar
   * de las subastas y NO de una Polla, que es otro juego. Un INVALIDADO de Polla
   * tampoco affecta Remates. Lo que bloquea en todas partes es el RETIRO, y eso
   * ya viene en `retirados`.
   */
  invalidadosPolla?: string[];
  updated_at?: string | null;
  /** Pizarra oficial en orden de llegada. */
  ganadores?: string[];
  /** El resultado ya se aplicó a las tablas fijas. */
  aplicado_a_tablas?: boolean;
};

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

export function normalizarCaballos(raw: unknown, retirados: Set<string>): EjemplarCarreraCentral[] {
  if (!Array.isArray(raw)) return [];
  return ordenarPorNumero(
    raw
      .map((c) => {
        const x = (c ?? {}) as Record<string, unknown>;
        const numero = String(x.numero ?? "").trim();
        return {
          numero,
          nombre: x.nombre != null ? String(x.nombre) : null,
          nacionalidad: x.nacionalidad != null ? String(x.nacionalidad) : null,
          ...(x.jockey != null ? { jockey: String(x.jockey) } : {}),
          ...(x.entrenador != null ? { entrenador: String(x.entrenador) } : {}),
          ...(x.peso != null ? { peso: x.peso as number | string } : {}),
          ...(x.medicamento != null ? { medicamento: String(x.medicamento) } : {}),
          ...(x.implementos != null ? { implementos: String(x.implementos) } : {}),
          retirado: x.retirado === true || retirados.has(numero),
        };
      })
      .filter((c) => c.numero)
  );
}

/**
 * `ganadores` se ha guardado con dos formas distintas a lo largo del tiempo:
 * como lista plana de números ("1/2/3" o ["1","2","3"]) y como lista de objetos
 * con puesto y nombre ({numero, puesto}). Las dos llegan a la misma UI, así que
 * se normalizan a `string[]` en el borde y ningún módulo tiene que adivinar.
 */
export function normalizarGanadores(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") return raw.split("/").map((x) => x.trim()).filter(Boolean);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (g == null) return "";
      if (typeof g === "object") return String((g as { numero?: unknown }).numero ?? "").trim();
      return String(g).trim();
    })
    .filter(Boolean);
}

/** El resultado embebido llega como objeto o como array de 1; se toma el primero. */
export function primerResultado(m: FilaCarreraMaestro): ResultadoDeCarrera | null {
  const r = m.resultados_carreras;
  if (Array.isArray(r)) return r[0] ?? null;
  return r ?? null;
}

const ESTADOS = new Set(["Programada", "Abierta", "Cerrada", "Resultados", "Liquidada"]);

/** Estados válidos del maestro (exportado para validar antes de escribir). */
export const ESTADOS_MAESTRO = ESTADOS;

/** Los estados que el semáforo y el Monitor saben pintar. */
export type EstadoCarrera = "Programada" | "Abierta" | "Cerrada" | "Resultados" | "Liquidada";

/**
 * El estado de la UI se DERIVA del resultado, no de una bandera suelta: si hay
 * ganador la carrera pasó a "Resultados" aunque el maestro siga en "Programada".
 * Antes `claseEstadoCarrera` del MonitorHipodromos caía siempre en "programada" y
 * el semáforo marcaba como pendiente una carrera ya liquidada.
 */
export function estadoDeCarrera(m: FilaCarreraMaestro, res: ResultadoDeCarrera | null): EstadoCarrera {
  if (res?.aplicado_a_tablas === true) return "Liquidada";
  if (normalizarGanadores(res?.ganadores).length > 0) return "Resultados";
  const propio = String(m.estado ?? "").trim();
  return ESTADOS.has(propio) ? (propio as EstadoCarrera) : "Programada";
}

/** Mapea una fila de la matriz al tipo que consume toda la plataforma. */
export function aCarreraCentral(m: FilaCarreraMaestro): CarreraCatalogo {
  const res = primerResultado(m);
  // El retiro manda la fila de resultados si la hay (es la lista oficial);
  // si no, el que tiene la propia fila de la matriz.
  const retiradosCentral = res?.retirados != null ? String(res.retirados) : m.retirados;
  const retirados = parsearRetirados(String(retiradosCentral ?? ""));
  return {
    id: m.id ?? undefined,
    fecha: String(m.fecha ?? "").slice(0, 10),
    hipodromo: String(m.hipodromo ?? "").trim().toUpperCase(),
    carrera: Number(m.carrera) || 0,
    caballos: normalizarCaballos(m.caballos, new Set(retirados)),
    retirados,
    // INV va pegado a los retiros a propósito: son las dos listas de ejemplares
    // que no participan, y leerlas una al lado de la otra evita confundirlas.
    invalidados: parsearRetirados(String(m.invalidado_remate ?? "")),
    invalidadosPolla: parsearRetirados(String(m.invalidado_polla ?? "")),
    distancia: m.distancia != null ? String(m.distancia) : null,
    superficie: m.superficie != null ? String(m.superficie) : null,
    premio: m.premio != null ? Number(m.premio) : null,
    hora: m.hora != null ? String(m.hora) : null,
    estado: estadoDeCarrera(m, res),
    // El orden de las claves importa: los tests comparan con JSON.stringify, así
    // que estos campos tienen que quedar donde los espera el contrato del tipo.
    origen: m.origen != null ? String(m.origen) : null,
    registrado_por: m.registrado_por != null ? String(m.registrado_por) : null,
    actualizado_por: m.actualizado_por != null ? String(m.actualizado_por) : null,
    verificado: m.verificado === true,
    verificado_por: m.verificado_por != null ? String(m.verificado_por) : null,
    verificado_at: m.verificado_at != null ? String(m.verificado_at) : null,
    updated_at: m.updated_at != null ? String(m.updated_at) : null,
    ganadores: normalizarGanadores(res?.ganadores ?? res?.orden_llegada),
    aplicado_a_tablas: res?.aplicado_a_tablas === true,
  };
}

/** Columnas del maestro, en el orden en que las pide el select. */
export const COLUMNAS_MAESTRO =
  "id, fecha, hipodromo, hipodromo_id, carrera, estado, caballos, retirados, distancia, superficie, premio, hora, origen, registrado_por, actualizado_por, verificado, verificado_por, verificado_at, invalidado_remate, invalidado_polla, updated_at";

// ---------------------------------------------------------------------------
// Fusión de filas duplicadas
// ---------------------------------------------------------------------------

/** Cuánta información real trae una fila: resultado primero, luego ejemplares. */
function riqueza(f: FilaCarreraMaestro): number {
  const res = primerResultado(f);
  const cab = Array.isArray(f.caballos) ? f.caballos.length : 0;
  return (res ? 1000 : 0) + cab;
}

function masReciente(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * FUSIÓN ACUMULATIVA de la lista de ejemplares de una carrera.
 *
 * La identidad del ejemplar dentro de la carrera es su NÚMERO DE GUALDRAPA.
 * Cuando llega un lote nuevo:
 *   - si el número ya existe, se ACTUALIZA (el dato nuevo pisa al viejo si
 *     viene informado; los campos que el lote no trae se conservan);
 *   - si el número es nuevo, se agrega;
 *   - los números que el lote NO trae se CONSERVAN.
 *
 * Esto último es lo que arregla la carga parcial: un lote que solo leyó 6 de
 * los 10 ejemplares no puede borrar los otros 4.
 *
 * Es GENÉRICA a propósito: la misma fusión sirve para los ejemplares de la
 * matriz (`{numero, nombre, nacionalidad, retirado}`) y para los del programa
 * (`{numero, nombre, nacionalidad, valor, ejemplar_id}`), y no puede perder
 * los campos extra (el valor y el id del padrón).
 */
export function fusionarEjemplaresAcumulativo<T extends Record<string, unknown>>(
  guardados: unknown,
  nuevos: unknown
): T[] {
  const salida: T[] = [];
  const porNumero = new Map<string, T>();

  const absorber = (crudo: unknown, esNuevo: boolean) => {
    if (!Array.isArray(crudo)) return;
    for (const item of crudo) {
      if (!item || typeof item !== "object") continue;
      const x = { ...(item as Record<string, unknown>) };
      const numero = String(x.numero ?? "").trim();
      if (!numero) continue;
      x.numero = numero;
      const previo = porNumero.get(numero);
      if (!previo) {
        const creado = x as T;
        porNumero.set(numero, creado);
        salida.push(creado);
        continue;
      }
      // Ya existe: el dato nuevo pisa al viejo SOLO si trae contenido; los
      // campos que el lote no menciona se conservan del guardado.
      for (const [k, v] of Object.entries(x)) {
        if (k === "numero") continue;
        const vacio = v === null || v === undefined || String(v).trim() === "";
        if (esNuevo) {
          if (!vacio) (previo as Record<string, unknown>)[k] = v;
        } else if (vacio && (previo as Record<string, unknown>)[k] === undefined) {
          (previo as Record<string, unknown>)[k] = v;
        }
      }
      // El retiro es acumulativo: si alguno de los dos lo tiene marcado, queda.
      if (x.retirado === true) (previo as Record<string, unknown>).retirado = true;
    }
  };

  absorber(guardados, false);
  absorber(nuevos, true);
  return ordenarPorNumero(salida as Array<{ numero?: string | number | null }>) as T[];
}

/** Une dos listas de ejemplares por número, sin perder ni duplicar. */
export function unirEjemplares(a: unknown, b: unknown): EjemplarMatriz[] {
  const salida: EjemplarMatriz[] = [];
  const vistos = new Set<string>();
  for (const crudo of [a, b]) {
    if (!Array.isArray(crudo)) continue;
    for (const item of crudo) {
      const x = (item ?? {}) as Record<string, unknown>;
      const numero = String(x.numero ?? "").trim();
      if (!numero || vistos.has(numero)) continue;
      vistos.add(numero);
      salida.push({
        numero,
        nombre: x.nombre != null ? String(x.nombre) : null,
        nacionalidad: x.nacionalidad != null ? String(x.nacionalidad) : null,
        retirado: x.retirado === true,
      });
    }
  }
  return ordenarPorNumero(salida);
}

/** Fusiona dos filas del MISMO (hipodromo, carrera) sin perder datos. */
function fusionarMaestro(a: FilaCarreraMaestro, b: FilaCarreraMaestro): FilaCarreraMaestro {
  // Gana la más rica; a igualdad, la más reciente.
  const [gana, pierde] =
    riqueza(b) > riqueza(a) || (riqueza(b) === riqueza(a) && String(b.updated_at ?? "") > String(a.updated_at ?? ""))
      ? [b, a]
      : [a, b];

  const resGana = primerResultado(gana);
  const resPierde = primerResultado(pierde);
  const retirados = normalizarRetirados([
    ...parsearRetirados(String(resGana?.retirados ?? "")),
    ...parsearRetirados(String(resPierde?.retirados ?? "")),
    ...parsearRetirados(String(gana.retirados ?? "")),
    ...parsearRetirados(String(pierde.retirados ?? "")),
  ]);
  const invalidados = normalizarRetirados([
    ...parsearRetirados(String(gana.invalidado_remate ?? "")),
    ...parsearRetirados(String(pierde.invalidado_remate ?? "")),
  ]);

  return {
    ...gana,
    caballos: unirEjemplares(gana.caballos, pierde.caballos),
    retirados: textoRetirados(retirados),
    invalidado_remate: textoRetirados(invalidados),
    estado:
      gana.estado ??
      pierde.estado ??
      (normalizarGanadores(resGana?.ganadores ?? resGana?.orden_llegada).length
        ? "Resultados"
        : resGana || resPierde
          ? "Cerrada"
          : undefined),
    updated_at: masReciente(gana.updated_at, pierde.updated_at) ?? undefined,
  };
}

/**
 * Colapsa a UNA fila por clave canónica `hipodromo|carrera` (la de
 * `claves.ts`, la misma que usan Marcas, Tablas, Dupletas y Remates).
 *
 * POR QUÉ EXISTE: la matriz es UNIQUE (fecha, hipodromo, carrera), pero si ese
 * índice no está aplicado en la base —o si una fila entró por un camino que no
 * lo respeta— la API devuelve la carrera repetida. Entonces los módulos que
 * arman la lista CHIP POR FILA la pintan dos veces ("C1 aparece 2 veces", el
 * contador dice 18 carreras para 13 reales) y una de las copias suele venir sin
 * ejemplares, así que la carrera salta a "Sin ejemplares registrados"
 * ("5 carrera(s) del filtro sin ejemplares") mientras Carreras del Día, que
 * lee la copia buena, sí muestra el padrón completo.
 *
 * Fusiona en vez de descartar: gana la fila más rica (resultado primero) y las
 * listas se unen (ejemplares por número, retiros e invalidados), de modo que
 * ninguna copia pierde información. Las filas sin hipódromo o sin número de
 * carrera válido se descartan: no son identificables y solo contaminan.
 */
/**
 * Resuelve el TEXTO de hipódromo que se debe ESCRIBIR en cada fila para que el
 * `onConflict (fecha,hipodromo,carrera)` de la matriz ACTUALICE la fila que ya
 * existe en lugar de insertar una segunda.
 *
 * El problema: la clave única de la matriz compara el TEXTO tal cual quedó
 * guardado ("LA RINCONADA" y "La Rinconada" son dos filas distintas), mientras
 * la app cruza los hipódromos por su clave canónica (mayúsculas sin espacios).
 * Un upsert ciego con "LA RINCONADA" sobre una BD que guarda "La Rinconada"
 * crea un DUPLICADO que solo `dedupFilasMaestro` vuelve a fusionar al LEER —
 * la UI se ve bien, pero la fila gemela queda huérfana en la base.
 *
 * Devuelve un Map clave → texto a usar: el TEXTO GUARDADO si existe una fila
 * con la misma clave canónica (fecha + hipódromo + número), o la forma canónica
 * en mayúsculas para las que son nuevas.
 */
export function hipodromosAEscribir(
  entradas: { fecha?: string | null; hipodromo: unknown; carrera: unknown }[],
  existentes: { fecha?: unknown; hipodromo?: unknown; carrera?: unknown }[]
): Map<string, string> {
  const guardados = new Map<string, string>();
  for (const f of existentes) {
    const hipo = String(f.hipodromo ?? "").trim();
    const num = numeroCarrera(f.carrera);
    if (!hipo || !num) continue;
    const clave = `${String(f.fecha ?? "").slice(0, 10)}|${claveHipodromo(hipo)}|${num}`;
    if (!guardados.has(clave)) guardados.set(clave, hipo);
  }
  const salida = new Map<string, string>();
  for (const e of entradas) {
    const hipo = String(e.hipodromo ?? "").trim().toUpperCase();
    const num = numeroCarrera(e.carrera);
    if (!hipo || !num) continue;
    const clave = `${String(e.fecha ?? "").slice(0, 10)}|${claveHipodromo(hipo)}|${num}`;
    salida.set(clave, guardados.get(clave) || hipo);
  }
  return salida;
}

/**
 * RESCATE del resultado cuando el EMBED no lo trajo.
 *
 * POR QUÉ EXISTE
 * --------------
 * `leerCarrerasMaestro` pide el resultado embebido (`resultados_carreras(*)`), que
 * PostgREST resuelve por la FK `resultados_carreras.carrera_id -> carreras.id`.
 * Esa columna puede quedar NULL: la migración la backfillea con una igualdad
 * EXACTA de hipódromo (`c.hipodromo = upper(trim(r.hipodromo))`), así que una
 * fila guardada como "La Rinconada" cuando la matriz dice "LA RINCONADA" nunca
 * se enlaza (el diagnóstico tiene una pasada que repara "resultados sueltos").
 * Cuando `carrera_id` es NULL el embed no devuelve NADA y no hay error: el
 * catálogo queda con `ganadores: []` y cualquier contador que salga de ahí
 * —el progreso de la jornada— se queda en cero para siempre.
 *
 * La cura NO es una segunda verdad: se lee la MISMA tabla `resultados_carreras`
 * por su clave natural (fecha + hipódromo + carrera, la de `claveCarrera`) y se
 * completa SOLO lo que el embed no trajo. Es un respaldo idempotente: si el
 * embed ya trajo el resultado, la fila se deja intacta.
 *
 * `resultados` son las filas crudas de `resultados_carreras` del día (se leen
 * todas en UNA consulta, como `cargarCarrerasDelDia`).
 */
export function completarResultadosPorClave(
  catalogo: CarreraCatalogo[],
  resultados: { fecha?: unknown; hipodromo?: unknown; carrera?: unknown; ganadores?: unknown; orden_llegada?: unknown; aplicado_a_tablas?: unknown }[]
): CarreraCatalogo[] {
  const porClave = new Map<string, (typeof resultados)[number]>();
  for (const r of resultados) {
    const k = claveCarrera(r.hipodromo, r.carrera, String(r.fecha ?? "").slice(0, 10));
    if (!k) continue;
    porClave.set(k, r);
  }
  return catalogo.map((c) => {
    // El embed ya respondió: no se toca (ni siquiera para "corregir").
    if (c.ganadores?.length || c.aplicado_a_tablas) return c;
    const r = porClave.get(claveCarrera(c.hipodromo, c.carrera, c.fecha));
    if (!r) return c;
    const ganadores = normalizarGanadores(r.ganadores ?? r.orden_llegada);
    const aplicado = r.aplicado_a_tablas === true;
    if (!ganadores.length && !aplicado) return c;
    return { ...c, ganadores, aplicado_a_tablas: aplicado, estado: aplicado ? "Liquidada" : "Resultados" };
  });
}

export function dedupFilasMaestro(filas: FilaCarreraMaestro[]): FilaCarreraMaestro[] {
  const porClave = new Map<string, FilaCarreraMaestro>();
  for (const f of filas) {
    const hipo = claveHipodromo(f.hipodromo);
    const num = numeroCarrera(f.carrera);
    if (!hipo || !num) continue;
    // La fecha entra en la clave aunque la consulta ya venga filtrada por ella:
    // si alguien pasa filas de dos jornadas, la C1 de una no se fusiona con la
    // C1 de la otra (son carreras distintas aunque compartan número).
    const dia = String(f.fecha ?? "").trim().slice(0, 10);
    const k = `${dia}|${hipo}|${num}`;
    const actual = porClave.get(k);
    porClave.set(k, actual ? fusionarMaestro(actual, f) : f);
  }
  return [...porClave.values()].sort(
    (a, b) =>
      claveHipodromo(a.hipodromo).localeCompare(claveHipodromo(b.hipodromo)) ||
      numeroCarrera(a.carrera) - numeroCarrera(b.carrera)
  );
}
