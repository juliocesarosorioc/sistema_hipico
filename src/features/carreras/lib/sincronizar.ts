/**
 * SINCRONIZACIÓN CON EL REGISTRO CENTRAL DE CARRERAS.
 *
 * La matriz `carreras` (una fila por fecha+hipódromo+carrera) es el ÚNICO lugar
 * del que se listan las carreras que se van a jugar. Pollas, Remates, WPS,
 * Marcas, Dupletas, Tablas Fijas, Gestión de Jugadas y Taquilla leen de ahí a
 * través de `useRegistroCentral`. Por eso TODA alta de carreras —venga del
 * cargador de IA (Gaceta), del Ensamblaje o de la carga manual de programa—
 * tiene que terminar en esta matriz.
 *
 * BUG QUE ESTO CORRIGE: el cargador de IA transcribía las carreras pero solo las
 * guardaba en su propio registro local (`gaceta_registro`), el historial
 * (`gaceta_procesada`) y el padrón (`ejemplares`). Nunca llamaba a la matriz, así
 * que las carreras "extraídas" solo se veían en esa pantalla y no existían para
 * el resto de los módulos.
 *
 * `guardarPrograma` es la vía canónica (documento del día `programa_dia` + alta
 * en la matriz). Como la matriz es la fuente que leen todos los módulos, si el
 * documento del día falla se escribe igual la matriz para no dejar la carrera
 * invisible. Aquí se agrupa por fecha y se FUSIONA con lo que ya haya ese día,
 * para no borrar las carreras de los otros hipódromos.
 */
import {
  guardarPrograma,
  hoyLocal,
  leerProgramaPorFecha,
  type CaballoPrograma,
  type CarreraPrograma,
} from "@/features/gaceta/lib/programa";
import { escribirCarrerasMaestro } from "@/features/carreras/lib/maestro";
import { fusionarEjemplaresAcumulativo } from "@/features/carreras/lib/maestro-nucleo";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";

/** Ejemplar tal como lo entrega la IA o el Ensamblaje (acepta valor/pts). */
export type EjemplarEntrante = {
  numero?: string | number;
  nombre?: string;
  nacionalidad?: string;
  valor?: number | string;
  pts?: number | string;
  ejemplar_id?: string | number | null;
};

/** Carrera heterogénea a registrar: sirve tanto para `CarreraRegistro` (IA)
 *  como para el buzón del Ensamblaje. Acepta `caballos` o `ejemplares`. */
export type CarreraEntrante = {
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha?: string | null;
  distancia?: number | string | null;
  superficie?: string | null;
  premio?: number | string | null;
  caballos?: EjemplarEntrante[] | null;
  ejemplares?: EjemplarEntrante[] | null;
};

export type ResSincronizar = {
  ok: boolean;
  /** Fechas (ISO) que se tocaron. */
  fechas: string[];
  /** Carreras efectivamente publicadas en el registro central. */
  guardadas: number;
  /** Error si la matriz no se pudo escribir. */
  error?: string;
};

function ejemplaresDe(c: CarreraEntrante): EjemplarEntrante[] {
  if (Array.isArray(c.caballos) && c.caballos.length) return c.caballos;
  if (Array.isArray(c.ejemplares)) return c.ejemplares;
  return [];
}

/** Normaliza a la forma `CarreraPrograma`, descartando lo que no se puede
 *  registrar: la matriz exige hipódromo y Nº de carrera > 0. */
export function aCarrerasPrograma(carreras: CarreraEntrante[]): CarreraPrograma[] {
  const out: CarreraPrograma[] = [];
  for (const c of carreras) {
    const hipodromo = String(c.hipodromo || "").trim().toUpperCase();
    const num = Number(c.carrera);
    if (!hipodromo || !Number.isFinite(num) || num <= 0) continue;
    const caballos: CaballoPrograma[] = ejemplaresDe(c)
      .map((e) => ({
        numero: (e.numero ?? "") as string | number,
        nombre: String(e.nombre || "").trim().toUpperCase(),
        nacionalidad: String(e.nacionalidad || "VE").toUpperCase() || "VE",
        valor: Number(e.valor ?? e.pts ?? 0) || 0,
        ejemplar_id: e.ejemplar_id ?? null,
      }))
      .filter((e) => e.nombre);
    out.push({
      hipodromo,
      fecha: c.fecha ? String(c.fecha).slice(0, 10) : null,
      carrera: num,
      distancia: Number(c.distancia) || 0,
      superficie: String(c.superficie || "ARENA").toUpperCase() || "ARENA",
      premio: Number(c.premio) || 0,
      caballos,
    });
  }
  return out;
}

const claveCarrera = (c: CarreraPrograma): string =>
  `${String(c.hipodromo).toUpperCase().trim()}|${Number(c.carrera)}`;

/**
 * Da de alta (o actualiza) las carreras dadas en el REGISTRO CENTRAL y avisa a
 * los módulos abiertos para que relean. Es idempotente: reenviar la misma lista
 * actualiza las filas por (fecha, hipódromo, carrera) en vez de duplicarlas.
 */
export async function sincronizarCarrerasAlCentral(
  carreras: CarreraEntrante[],
  creadoPor?: string
): Promise<ResSincronizar> {
  const validas = aCarrerasPrograma(carreras);
  if (!validas.length) return { ok: true, fechas: [], guardadas: 0 };

  const porFecha = new Map<string, CarreraPrograma[]>();
  for (const c of validas) {
    const f = c.fecha || hoyLocal();
    const arr = porFecha.get(f) ?? [];
    arr.push({ ...c, fecha: f });
    porFecha.set(f, arr);
  }

  const fechas: string[] = [];
  let guardadas = 0;

  for (const [fecha, nuevas] of porFecha) {
    const actual = await leerProgramaPorFecha(fecha);
    const previas = actual.data?.carreras ?? [];
    const setNuevas = new Set(nuevas.map(claveCarrera));
    // Se conservan las carreras del día que NO vienen en esta tanda (otros
    // hipódromos / otras altas): el registro central es acumulativo.
    const otras = previas.filter((c) => !setNuevas.has(claveCarrera(c)));
    // Y de las que SÍ vienen, se conservan los EJEMPLARES que el lote no
    // trajo: un lote parcial (Belmont 1-3, luego Belmont 4-6) tiene que SUMAR
    // ejemplares, nunca reemplazar la lista. La identidad es el número de
    // gualdrapa, que es lo que identifica al ejemplar dentro de la carrera.
    const porClavePrevia = new Map(previas.map((c) => [claveCarrera(c), c]));
    const fusionadas: CarreraPrograma[] = nuevas.map((c) => {
      const previa = porClavePrevia.get(claveCarrera(c));
      if (!previa) return c;
      return {
        ...c,
        caballos: fusionarEjemplaresAcumulativo<CaballoPrograma>(
          previa.caballos ?? [],
          c.caballos ?? []
        ),
      };
    });
    const hipodromos = [
      ...new Set(
        [...(actual.data?.hipodromos ?? []), ...nuevas.map((c) => c.hipodromo)]
          .map((h) => String(h).toUpperCase().trim())
          .filter(Boolean)
      ),
    ];

    // 1) Vía canónica: guarda el documento del día (`programa_dia`) Y da de alta
    //    las carreras en la matriz `carreras`.
    const res = await guardarPrograma({ fecha, hipodromos, carreras: [...otras, ...fusionadas] }, creadoPor);
    if (res.ok) {
      fechas.push(fecha);
      guardadas += nuevas.length;
      continue;
    }

    // 2) Si el documento del día no se pudo guardar, la MATRIZ —de donde leen
    //    TODOS los módulos— se escribe igual: sin esto la carrera quedaría
    //    invisible aunque la extracción haya sido correcta.
    //
    //    `fusionar_ejemplares: true` porque esta es la vía de la GACETA, que
    //    carga por LOTES: un lote parcial tiene que SUMAR ejemplares a la
    //    carrera, nunca borrar los que ya estaban leídos.
    const matriz = await escribirCarrerasMaestro(
      nuevas.map((c) => ({
        fecha,
        hipodromo: c.hipodromo,
        carrera: Number(c.carrera),
        estado: "Programada",
        caballos: (c.caballos ?? []).map((e) => ({
          numero: e.numero,
          nombre: e.nombre,
          nacionalidad: e.nacionalidad,
        })),
        distancia: c.distancia ? String(c.distancia) : null,
        superficie: c.superficie ?? null,
        premio: c.premio ?? null,
        origen: "ia",
        fusionar_ejemplares: true,
      }))
    );
    if (!matriz.ok) return { ok: false, fechas, guardadas, error: matriz.error || res.error };
    fechas.push(fecha);
    guardadas += matriz.guardadas ?? nuevas.length;
  }

  // Refresca la caché central: Pollas, Remates, WPS, Marcas, Dupletas, Tablas
  // Fijas, Gestión de Jugadas y Taquilla la ven de inmediato, sin recargar.
  useRegistroCentral.getState().invalidarCarreras();
  return { ok: true, fechas, guardadas };
}
