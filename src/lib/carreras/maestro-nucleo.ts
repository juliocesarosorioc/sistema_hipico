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
import { parsearRetirados, textoRetirados, normalizarRetirados } from "./retiros-nucleo";
import { claveHipodromo, numeroCarrera } from "./claves";

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
};

export type EjemplarCarreraCentral = {
  numero: string;
  nombre?: string | null;
  nacionalidad?: string | null;
  /** Retirado según la lista CENTRAL de la carrera. */
  retirado?: boolean;
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
};

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

/** Une dos listas de ejemplares por número, sin perder ni duplicar. */
function unirEjemplares(a: unknown, b: unknown): EjemplarMatriz[] {
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
