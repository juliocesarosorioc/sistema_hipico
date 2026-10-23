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
import { escribirCarrerasMaestro, leerCarrerasMaestro, reintentarMaestro } from "@/features/carreras/lib/maestro";
import { fusionarCargaGaceta } from "@/features/carreras/lib/maestro-nucleo";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";
import { useHipodromosStore } from "@/shared/store/useHipodromosStore";
import { crearHipodromo, listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { paisHipodromo } from "@/features/gaceta/lib/ui";
import { claveHipodromo } from "@/features/carreras/lib/claves";

/** Ejemplar tal como lo entrega la IA o el Ensamblaje (acepta valor/pts). */
export type EjemplarEntrante = {
  numero?: string | number;
  nombre?: string;
  nacionalidad?: string;
  valor?: number | string;
  pts?: number | string;
  ejemplar_id?: string | number | null;
  jockey?: string;
  entrenador?: string;
  stud?: string;
  haras?: string;
  pedigree?: { padre?: string; madre?: string; abueloMaterno?: string };
  edad?: number | string;
  sexo?: string;
  peso?: string | number;
  peso_programado?: string | number;
  peso_bruto?: string | number;
  descargo_aprendiz?: string | number;
  peso_neto?: string | number;
  peso_lbs?: string | number;
  descargo_lbs?: string | number;
  peso_fisico?: string | number;
  peso_optimo?: string | number;
  morning_line?: string;
  claiming_price?: string | number;
  beyer?: string | number;
  speed_rating?: string | number;
  pace_figures?: { early?: number; late?: number; e1?: number; e2?: number; e3?: number };
  aptitud_superficie?: Record<string, number | string | null>;
  retrospecto?: Array<Record<string, unknown>>;
  trackeos?: Array<Record<string, unknown>>;
  medicamento?: string;
  implementos?: string;
};

/** Carrera heterogénea a registrar: sirve tanto para `CarreraRegistro` (IA)
 *  como para el buzón del Ensamblaje. Acepta `caballos` o `ejemplares`. */
export type CarreraEntrante = {
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha?: string | null;
  distancia?: number | string | null;
  distancia_texto?: string;
  superficie?: string | null;
  condicion_pista?: string;
  condicion_carrera?: string;
  codigo_carrera?: string;
  hora?: string;
  premio?: number | string | null;
  morning_line?: string;
  beyer_par?: number | string;
  record_pista?: string;
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
  resultados: ResultadoCargaCarrera[];
};

export type EstadoCargaCarrera = "CREADA" | "ACTUALIZADA_COMPLETADA" | "PREVIAMENTE_CARGADA" | "PROTEGIDA" | "ERROR";
export type ResultadoCargaCarrera = {
  fecha: string;
  hipodromo: string;
  carrera: number | null;
  estado: EstadoCargaCarrera;
  motivo: string;
};

function ejemplaresDe(c: CarreraEntrante): EjemplarEntrante[] {
  if (Array.isArray(c.caballos) && c.caballos.length) return c.caballos;
  if (Array.isArray(c.ejemplares)) return c.ejemplares;
  return [];
}

async function asegurarHipodromosCatalogo(carreras: CarreraPrograma[]): Promise<string | null> {
  const listado = await listarHipodromos();
  if (!listado.ok) return listado.error ?? "No se pudo consultar el catálogo de hipódromos.";
  const presentes = new Set(listado.data.map((h) => claveHipodromo(h.nombre)));
  let seAgrego = false;
  for (const nombre of new Set(carreras.map((c) => c.hipodromo))) {
    const clave = claveHipodromo(nombre);
    if (!clave || presentes.has(clave)) continue;
    const alta = await crearHipodromo({ nombre, pais: paisHipodromo(nombre) ?? "OTRO" });
    if (!alta.ok) return `No se pudo registrar el hipódromo ${nombre}: ${alta.error ?? "error desconocido"}`;
    presentes.add(clave);
    seAgrego = true;
  }
  if (seAgrego) {
    reintentarMaestro();
    useHipodromosStore.getState().invalidar();
    useRegistroCentral.getState().invalidarHipodromos();
  }
  return null;
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
        jockey: e.jockey,
        entrenador: e.entrenador,
        stud: e.stud,
        haras: e.haras,
        pedigree: e.pedigree,
        edad: e.edad,
        sexo: e.sexo,
        peso: e.peso,
        peso_programado: e.peso_programado,
        peso_bruto: e.peso_bruto,
        descargo_aprendiz: e.descargo_aprendiz,
        peso_neto: e.peso_neto,
        peso_lbs: e.peso_lbs,
        descargo_lbs: e.descargo_lbs,
        peso_fisico: e.peso_fisico,
        peso_optimo: e.peso_optimo,
        morning_line: e.morning_line,
        claiming_price: e.claiming_price,
        beyer: e.beyer,
        speed_rating: e.speed_rating,
        pace_figures: e.pace_figures,
        aptitud_superficie: e.aptitud_superficie,
        retrospecto: e.retrospecto,
        trackeos: e.trackeos,
        medicamento: e.medicamento,
        implementos: e.implementos,
      }))
      .filter((e) => e.nombre);
    out.push({
      hipodromo,
      fecha: c.fecha ? String(c.fecha).slice(0, 10) : null,
      carrera: num,
      distancia: Number(c.distancia) || 0,
      distancia_texto: c.distancia_texto,
      superficie: String(c.superficie || "ARENA").toUpperCase() || "ARENA",
      condicion_pista: c.condicion_pista,
      condicion_carrera: c.condicion_carrera,
      codigo_carrera: c.codigo_carrera,
      hora: c.hora,
      premio: Number(c.premio) || 0,
      morning_line: c.morning_line,
      beyer_par: c.beyer_par,
      record_pista: c.record_pista,
      caballos,
    });
  }
  return out;
}

const claveCarrera = (c: CarreraPrograma): string =>
  `${claveHipodromo(c.hipodromo)}|${Number(c.carrera)}`;

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
  const resultados: ResultadoCargaCarrera[] = carreras
    .filter((c) => !aCarrerasPrograma([c]).length)
    .map((c) => ({
      fecha: String(c.fecha ?? hoyLocal()).slice(0, 10),
      hipodromo: String(c.hipodromo ?? "Sin hipódromo"),
      carrera: Number(c.carrera) || null,
      estado: "ERROR",
      motivo: "No cargada: se requiere hipódromo y número de carrera válido.",
    }));
  if (!validas.length) return { ok: resultados.every((r) => r.estado !== "ERROR"), fechas: [], guardadas: 0, resultados };

  const porFecha = new Map<string, CarreraPrograma[]>();
  for (const c of validas) {
    const f = c.fecha || hoyLocal();
    const arr = porFecha.get(f) ?? [];
    arr.push({ ...c, fecha: f });
    porFecha.set(f, arr);
  }

  const fechas: string[] = [];
  let guardadas = 0;

  const errorHipodromos = await asegurarHipodromosCatalogo(validas);
  if (errorHipodromos) {
    return {
      ok: false,
      fechas,
      guardadas,
      resultados: [
        ...resultados,
        ...validas.map((c) => ({
          fecha: String(c.fecha ?? hoyLocal()).slice(0, 10),
          hipodromo: c.hipodromo,
          carrera: Number(c.carrera),
          estado: "ERROR" as const,
          motivo: errorHipodromos,
        })),
      ],
      error: errorHipodromos,
    };
  }

  for (const [fecha, nuevas] of porFecha) {
    const matrizActual = await leerCarrerasMaestro(fecha);
    if (!matrizActual.ok) {
      const error = matrizActual.error ?? "No se pudo leer el catálogo central antes de sincronizar.";
      return {
        ok: false,
        fechas,
        guardadas,
        resultados: [
          ...resultados,
          ...nuevas.map((c) => ({
            fecha,
            hipodromo: c.hipodromo,
            carrera: Number(c.carrera),
            estado: "ERROR" as const,
            motivo: `No se modificó para evitar duplicados: ${error}`,
          })),
        ],
        error,
      };
    }
    const actuales = new Map(
      matrizActual.filas.map((fila) => [`${claveHipodromo(fila.hipodromo)}|${Number(fila.carrera)}`, fila])
    );
    const mergeadas: CarreraPrograma[] = [];
    const guardables: CarreraPrograma[] = [];
    for (const nueva of nuevas) {
      const clave = `${claveHipodromo(nueva.hipodromo)}|${Number(nueva.carrera)}`;
      const existente = actuales.get(clave);
      if (!existente) {
        mergeadas.push(nueva);
        guardables.push(nueva);
        resultados.push({
          fecha,
          hipodromo: nueva.hipodromo,
          carrera: Number(nueva.carrera),
          estado: "CREADA",
          motivo: `Registrada por primera vez con ${nueva.caballos.length} ejemplares.`,
        });
        continue;
      }
      const resultado = existingProtegida(existente);
      if (resultado) {
        resultados.push({
          fecha,
          hipodromo: nueva.hipodromo,
          carrera: Number(nueva.carrera),
          estado: "PROTEGIDA",
          motivo: resultado,
        });
        continue;
      }
      const fusion = fusionarCargaGaceta(existente, {
        ...nueva,
        fecha: nueva.fecha ?? fecha,
        carrera: Number(nueva.carrera),
        distancia: nueva.distancia != null ? String(nueva.distancia) : null,
        estado: existente.estado ?? "Programada",
        caballos: nueva.caballos.map((e) => ({ ...e })),
      });
      const carreraMergeada = fusion.carrera as CarreraPrograma;
      mergeadas.push(carreraMergeada);
      if (fusion.cambio) guardables.push(carreraMergeada);
      resultados.push({
        fecha,
        hipodromo: nueva.hipodromo,
        carrera: Number(nueva.carrera),
        estado: fusion.cambio ? "ACTUALIZADA_COMPLETADA" : "PREVIAMENTE_CARGADA",
        motivo: fusion.cambio
          ? `Completados ${fusion.ejemplaresCompletados} ejemplares/campos faltantes: ${fusion.camposCompletados.join(", ")}.`
          : "Omitida sin cambios: la carrera ya estaba registrada y no había campos pendientes de completar.",
      });
    }
    const actual = await leerProgramaPorFecha(fecha);
    const previas = actual.data?.carreras ?? [];
    const setNuevas = new Set(mergeadas.map(claveCarrera));
    // Se conservan las carreras del día que NO vienen en esta tanda (otros
    // hipódromos / otras altas): el registro central es acumulativo.
    const otras = previas.filter((c) => !setNuevas.has(claveCarrera(c)));
    // Y de las que SÍ vienen, se conservan los EJEMPLARES que el lote no
    // trajo: un lote parcial (Belmont 1-3, luego Belmont 4-6) tiene que SUMAR
    // ejemplares, nunca reemplazar la lista. La identidad es el número de
    // gualdrapa, que es lo que identifica al ejemplar dentro de la carrera.
    const porClavePrevia = new Map(previas.map((c) => [claveCarrera(c), c]));
    const fusionadas: CarreraPrograma[] = mergeadas.map((c) => {
      const previa = porClavePrevia.get(claveCarrera(c));
      if (!previa) return c;
      return {
        ...c,
        caballos: c.caballos?.length ? c.caballos : previa.caballos ?? [],
      };
    });
    const hipodromos = [
      ...new Set(
        [...(actual.data?.hipodromos ?? []), ...mergeadas.map((c) => c.hipodromo)]
          .map((h) => String(h).toUpperCase().trim())
          .filter(Boolean)
      ),
    ];

    // 1) Vía canónica: guarda el documento del día (`programa_dia`) Y da de alta
    //    las carreras en la matriz `carreras`.
    const res = await guardarPrograma(
      { fecha, hipodromos, carreras: [...otras, ...fusionadas] },
      creadoPor,
      { registrarEnMatriz: false }
    );

    // 2) Si el documento del día no se pudo guardar, la MATRIZ —de donde leen
    //    TODOS los módulos— se escribe igual: sin esto la carrera quedaría
    //    invisible aunque la extracción haya sido correcta.
    //
    // El documento JSON del programa no vuelve a escribir en la matriz las
    // carreras protegidas; solo se publican las filas validadas.
    const matriz = guardables.length ? await escribirCarrerasMaestro(
      guardables.map((c) => ({
        fecha,
        hipodromo: c.hipodromo,
        carrera: Number(c.carrera),
        estado: c.estado ?? "Programada",
        caballos: (c.caballos ?? []).map((e) => ({
          numero: e.numero,
          nombre: e.nombre,
          nacionalidad: e.nacionalidad,
          ejemplar_id: e.ejemplar_id,
          jockey: e.jockey,
          entrenador: e.entrenador,
          stud: e.stud,
          haras: e.haras,
          pedigree: e.pedigree,
          edad: e.edad,
          sexo: e.sexo,
          peso: e.peso,
          peso_programado: e.peso_programado,
          peso_bruto: e.peso_bruto,
          descargo_aprendiz: e.descargo_aprendiz,
          peso_neto: e.peso_neto,
          peso_lbs: e.peso_lbs,
          descargo_lbs: e.descargo_lbs,
          peso_fisico: e.peso_fisico,
          peso_optimo: e.peso_optimo,
          morning_line: e.morning_line,
          claiming_price: e.claiming_price,
          beyer: e.beyer,
          speed_rating: e.speed_rating,
          pace_figures: e.pace_figures,
          aptitud_superficie: e.aptitud_superficie,
          retrospecto: e.retrospecto,
          trackeos: e.trackeos,
          medicamento: e.medicamento,
          implementos: e.implementos,
        })),
        distancia: c.distancia ? String(c.distancia) : null,
        superficie: c.superficie ?? null,
        premio: c.premio ?? null,
        origen: "ia",
        fusionar_ejemplares: true,
      }))
    ) : { ok: true, guardadas: 0 };
    if (!matriz.ok) {
      return {
        ok: false,
        fechas,
        guardadas,
        resultados: resultados.map((r) =>
          r.fecha === fecha && r.estado !== "PROTEGIDA" && r.estado !== "PREVIAMENTE_CARGADA"
            ? { ...r, estado: "ERROR", motivo: `No se pudo registrar: ${matriz.error || res.error}` }
            : r
        ),
        error: matriz.error || res.error,
      };
    }
    fechas.push(fecha);
    guardadas += matriz.guardadas ?? nuevas.length;
    if (!res.ok) {
      resultados.push({
        fecha,
        hipodromo: "Programa del día",
        carrera: null,
        estado: "ERROR",
        motivo: `La matriz fue sincronizada, pero falló el documento histórico: ${res.error ?? "error desconocido"}`,
      });
    }
  }

  // Refresca la caché central: Pollas, Remates, WPS, Marcas, Dupletas, Tablas
  // Fijas, Gestión de Jugadas y Taquilla la ven de inmediato, sin recargar.
  useRegistroCentral.getState().invalidarCarreras();
  return { ok: resultados.every((r) => r.estado !== "ERROR"), fechas, guardadas, resultados };
}

function existingProtegida(fila: { estado?: string | null; resultados_carreras?: unknown }): string | null {
  const estado = String(fila.estado ?? "").toUpperCase();
  const resultado = fila.resultados_carreras;
  const lista = Array.isArray(resultado) ? resultado : resultado ? [resultado] : [];
  const conResultado = lista.length > 0;
  if (estado === "LIQUIDADA" || estado === "RESULTADOS" || estado === "CERRADA" || estado === "PAGADA" || conResultado) {
    return "Protegida: la carrera tiene resultado, liquidación o cierre; no se alteraron sus datos operativos.";
  }
  return null;
}
