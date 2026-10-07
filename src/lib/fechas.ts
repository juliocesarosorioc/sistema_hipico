// ============================================================================
// FECHAS — UNICA FUENTE DE VERDAD.
//
// POR QUE ESTE ARCHIVO EXISTE (el incidente del 04-10-2026)
//
// El 4 de octubre de 2026 se publicaron 13 carreras de LA RINCONADA. Tres
// (C10, C11 y C12) quedaron fechadas 2026-04-10 en `tablas_fijas`, es decir, el
// 10 de ABRIL. Consecuencia: no aparecian en Tablas Fijas ni en Gestion de
// Jugadas (ambas filtran por fecha) y tampoco en Marcas, que ademas las leia de
// `resultados_carreras`, donde no existian.
//
// La cadena del fallo, paso a paso:
//
//   1. El operador escribe la fecha como "04-10-2026" (dia/mes, como se escribe
//      y se LEE en Venezuela).
//   2. `normalizarFechaIso` de la Gaceta decia en su comentario aceptar
//      "DD-MM-YYYY", pero su expresion regular era
//      `^(\d{1,2})[/.](\d{1,2})[/.](\d{4})` — la clase `[/.]` NO incluye el
//      guion. "04-10-2026" no cuadraba y la funcion devolvia `null`.
//   3. Devolver `null` no era fallar: era NO OPINAR. Los llamadores trataban el
//      `null` como "no hay fecha conocida" y dejaban pasar el TEXTO CRUDO.
//   4. El texto crudo "04-10-2026" llego tal cual a Postgres. Ni Postgres ni
//      Javascript tienen una convencion propia para "04-10-2026": lo leen como
//      MM-DD-YYYY, o sea el 10 de abril de 2026. De ahi el 2026-04-10.
//
// O sea: DOS interpretes de la misma fecha (la app en DD/MM, el servidor en
// MM/DD) y NADIE en la frontera exigio un formato. El 04-10 es justamente el
// caso ambiguo clasico: "04/10" puede ser 4 de octubre o 10 de abril. Cuando
// ambos pueden pasar, el sistema elige en silencio. Eso no puede volver a pasar.
//
// LAS TRES REGLAS QUE ESTE MODULO ESTABLECE
//
//   A. A la base de datos SOLO sale ISO 8601 `YYYY-MM-DD`. Nunca texto libre,
//      nunca `04-10-2026`. Quien habla con Postgres no decide el idioma.
//
//   B. Ante una entrada ambigua NO se adivina en silencio. Se devuelve la
//      interpretacion por convencion (DD/MM, que es la de la operacion) y la
//      lista de alternativas, para que la interfaz pueda exigir confirmacion.
//   C. La validacion es FAIL-CLOSED. Un validador que devuelve `null` y deixa
//      pasar el original es peor que no tener validador, porque aparenta
//      proteccion. `exigirFechaIso` LANZA con un mensaje accionable; no hay
//      caminho en el que la fecha sin validar llegue al INSERT.
//
// QUE NO HACEMOS Y POR QUE
// No cambiamos la convencion de la operacion: se sigue escribiendo dia/mes. Lo
// que cambia es que la conversion ocurre UNA vez, aqui, y de lo que sale es
// siempre ISO. Tampoco se "adivina" una fecha a partir del nombre del archivo o
// de la fecha del sistema: una carrera que no tiene fecha es un error visible,
// no un 4 de octubre silencioso.
// ============================================================================

/** Meses en espanol que la Gaceta (texto de la IA) puede traer. */
const MESES: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

/**
 * Resultado de interpretar una fecha.
 *
 * - `iso`: la interpretacion por CONVENCION (dia/mes/anio). Es `null` cuando el
 *   texto no se puede interpretar o no es una fecha real de calendario.
 * - `ambigua`: `true` cuando el texto admite dos fechas distintas y validas
 *   (caso clasico "04-10-2026"). La interfaz debe pedir confirmacion.
 * - `alternativas`: todas las fechas ISO validas a las que podria referirse el
 *   texto, ordenadas. Con dos elementos = ambigua; con uno = no ambigua.
 * - `motivo`: por que no se pudo interpretar, en palabras, para el operador.
 */
export type LecturaFecha = {
  iso: string | null;
  ambigua: boolean;
  alternativas: string[];
  motivo: string | null;
};

/** Construye `YYYY-MM-DD` y RECHAZA fechas que no existen (30 de febrero, etc). */
function isoDe(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  // Dia 0 de mes = mes anterior: se usa como control de Overflow.
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO 8601 `YYYY-MM-DD` Y que sea una fecha real de calendario. */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!mm) return false;
  return isoDe(Number(mm[1]), Number(mm[2]), Number(mm[3])) !== null;
}

/** Normaliza a ISO lo que ya viene de un `date`, `timestamp` o ISO con hora. */
function desdeIsoConHora(s: string): string | null {
  const mm = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (!mm) return null;
  return isoDe(Number(mm[1]), Number(mm[2]), Number(mm[3]));
}

/**
 * Interpreta una fecha escrita por una persona o extraida por la IA, y DICE
 * cuando el texto es ambiguo en vez de resolverlo sin avisar.
 *
 * Formatos aceptados:
 *   - `2026-10-04`, `2026/10/04`, `2026-10-04T00:00:00Z`  (ISO, no ambiguo)
 *   - `04/10/2026`, `04-10-2026`, `4.10.2026`              (DD/MM/AAAA: el del pais)
 *   - `Domingo, 4 de Octubre de 2026`                       (texto de la Gaceta)
 */
export function interpretarFecha(v: unknown): LecturaFecha {
  const ninguna = (motivo: string): LecturaFecha => ({ iso: null, ambigua: false, alternativas: [], motivo });

  if (v === null || v === undefined) return ninguna("No se recibio ninguna fecha.");
  const s = String(v).trim();
  if (!s) return ninguna("La fecha esta vacia.");

  // --- 1) ISO: year primero. Nunca ambiguo. ---
  const iso = desdeIsoConHora(s);
  if (iso) return { iso, ambigua: false, alternativas: [iso], motivo: null };

  // --- 2) "Domingo, 4 de Octubre de 2026" y variantes. Sin ambiguedad: el mes
  //        viene con nombre. ---
  const conMes = /^[\p{L}\s,]*?(\d{1,2})\s*(?:de\s+|del\s+)?([\p{L}]+)\.?\s*(?:de\s+|del\s+)?(\d{4})\s*$/u.exec(s);
  if (conMes) {
    const d = Number(conMes[1]);
    const clave = conMes[2].toLowerCase().replace(/[^a-z]/g, "");
    const m = MESES[clave];
    if (m) {
      const r = isoDe(Number(conMes[3]), m, d);
      return r
        ? { iso: r, ambigua: false, alternativas: [r], motivo: null }
        : ninguna(`"${d}" no existe en ${conMes[2]}.`);
    }
    return ninguna(`No se reconoce el mes "${conMes[2]}".`);
  }

  // --- 3) DD/MM/AAAA o DD-MM-AAAA. AQUI ESTA LA AMBIGUEDAD. ---
  //     El guion va INCLUIDO a proposito: el operador escribe con guion todos
  //     los dias, y este modulo existe justamente para que ese guion se
  //     interprete aqui y no en el servidor. (El bug era la clase `[/.]`,
  //     que dejaba pasar el guion y por eso el texto crudo se iba al INSERT.)
  const ddmm = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(s);
  if (ddmm) {
    const a = Number(ddmm[1]);
    const b = Number(ddmm[2]);
    const y = Number(ddmm[3]);

    const comoDiaMes = isoDe(y, b, a); // convencion del pais: 04-10-2026 -> 2026-10-04
    const comoMesDia = isoDe(y, a, b); // convencion de los estados unidos

    const alts: string[] = [];
    if (comoDiaMes) alts.push(comoDiaMes);
    if (comoMesDia && comoMesDia !== comoDiaMes) alts.push(comoMesDia);

    if (!alts.length) return ninguna(`"${s}" no es una fecha valida.`);

    return {
      iso: comoDiaMes ?? comoMesDia,
      ambigua: alts.length > 1,
      alternativas: alts,
      motivo: null,
    };
  }

  // --- 4) Digitos sueltos: "20261004" (ISO compacto). ---
  const compacto = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compacto) {
    const r = isoDe(Number(compacto[1]), Number(compacto[2]), Number(compacto[3]));
    if (r) return { iso: r, ambigua: false, alternativas: [r], motivo: null };
    return ninguna(`"${s}" no es una fecha valida.`);
  }

  return ninguna(`"${s}" no tiene un formato de fecha reconocible. Use AAAA-MM-DD o DD/MM/AAAA.`);
}

/**
 * LA FRONTERA. Devuelve ISO o LANZA.
 *
 * Se usa en todo lo que va a persistir una fecha. No existe el camino
 * "devuelve null y sigue": si la fecha no es valida, la operacion se detiene
 * con un mensaje que el operador puede entender y corregir.
 *
 * @param ambiguaSi Cuando es `true` (por defecto), una entrada ambigua como
 *   "04-10-2026" tambien detiene la operacion: el operador debe confirmarla.
 *   Pase `false` solo en lecturas (la IA de la Gaceta, que se revisan a mano).
 */
export function exigirFechaIso(v: unknown, contexto: string, ambiguaSi = true): string {
  const r = interpretarFecha(v);
  if (!r.iso) throw new Error(`${contexto}: ${r.motivo ?? "fecha invalida"}`);
  if (ambiguaSi && r.ambigua) {
    throw new Error(
      `${contexto}: "${String(v).trim()}" es una fecha AMBIGUA: puede ser ` +
        `${r.alternativas.join(" o ")}. Escriba el ano primero (AAAA-MM-DD) para ` +
        `dejar claro el dia.`
    );
  }
  return r.iso;
}

/**
 * Version que devuelve `null` en vez de lanzar, para UI que necesita=live para
 * distinguir "vacio" de "escrito mal". Aun asi devuelve AMBIGUA para que el
 * campo se resalte en vez de aceptar en silencio.
 */
export function fechaOpcional(v: unknown): LecturaFecha {
  if (v === null || v === undefined || String(v).trim() === "") {
    return { iso: null, ambigua: false, alternativas: [], motivo: null };
  }
  return interpretarFecha(v);
}

/** `2026-10-04` -> `04/10/2026`, para mostrar y para `<input type="date">`. */
export function isoAFechaLocal(iso: string): string {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!mm) return iso;
  return `${mm[3]}/${mm[2]}/${mm[1]}`;
}
