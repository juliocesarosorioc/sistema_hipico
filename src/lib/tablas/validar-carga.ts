// ============================================================================
// VALIDACION DE LA CARGA — antes de que una carrera llegue a la base.
//
// EL INCIDENTE
// El 04-10-2026 se publicaron 13 carreras de LA RINCONADA. Tres (C10, C11, C12)
// quedaron en `tablas_fijas` con fecha 2026-04-10 — el 10 de ABRIL — porque el
// texto "04-10-2026" se interpretó como MM-DD. No se vieron ni en Tablas Fijas
// ni en Gestión de Jugadas (filtran por fecha) ni en Marcas (leen el central).
//
// La defensa correcta NO es confiar en que todos escriban la fecha bien. Es que
// sea imposible publicar una carrera en una fecha que no sea la de la jornada
// que el operador tiene abierta en pantalla.
//
// QUE HACE ESTE ARCHIVO
// Antes de publicar, revisa TODAS las carreras del ensamblaje y dice, una por
// una, por qué no se puede publicar. Devuelve TODOS los problemas juntos (no
// el primero) para que el operador no tenga que corregirlos de uno en uno.
//
// LAS CUATRO REGLAS
//   1. Una fecha que no se puede interpretar NO se publica. Antes se publicaba
//      en crudo y el servidor decidía el día (regla A de `@/lib/fechas`).
//   2. Una fecha ambigua ("04-10-2026": ¿4 de octubre o 10 de abril?) NO se
//      publica sin que quede claro cuál es. Aquí no hay forma de "elegir por el
//      operador": se rechaza y se pide el año primero.
//   3. La fecha de cada carrera debe ser LA DE LA JORNADA ABIERTA. Si la
//      tarjeta dice una fecha distinta a la que el operador tiene seleccionada,
//      casi siempre es el error de captura otra vez, o dos jornadas mezcladas
//      en el mismo ensamblaje. Publicar en la jornada equivocada es el daño
//      exacto que se quiere evitar.
//   4. Solo sale ISO. Ni una fecha en crudo llega al INSERT.
//
// POR QUE ESTO NO ESTA DENTRO DEL COMPONENTE
// Porque una regla de negocio que no tiene pruebas es una regla que alguien
// borra cuando "estorba". Esto es puro y está en `pruebas/fechas.test.ts`.
// ============================================================================
// Import RELATIVO a propósito (como `tablas/tipos.ts` → `../horseColors`): las
// pruebas compilan a CommonJS y corren en node, donde el alias `@/` no se
// resuelve. Con `@/lib/fechas` el runner se cae con "Cannot find module".
import { esFechaIso, interpretarFecha } from "../fechas";

/** Lo mínimo que hay que saber de un draft para validar su fecha. */
export type DraftParaValidar = { uid: string; hipodromo: string; carrera: string; fecha?: string | null };

/** Una carrera que no se puede publicar, con el motivo y cómo arreglarlo. */
export type ProblemaDeCarga = {
  uid: string;
  hipodromo: string;
  carrera: string;
  /** Texto tal como está en la tarjeta, para que el operador lo ubique. */
  fechaEnPantalla: string;
  motivo: string;
  /** Que hacer para desbloquearla. */
  como: string;
};

export type ResultadoValidacionCarga = {
  ok: boolean;
  problemas: ProblemaDeCarga[];
  /** Fecha ISO de la jornada, ya verificada. */
  fechaIso: string;
};

/**
 * Valida que todas las carreras del ensamblaje se publiquen en la fecha de la
 * jornada abierta. Devuelve `ok: true` solo si no hay NINGÚN problema.
 *
 * @param fechaJornada La fecha que el operador tiene seleccionada en pantalla.
 *   Viene de un `<input type="date">`, así que ya es ISO; aun así se valida.
 */
export function validarFechasDeCarga(
  drafts: DraftParaValidar[],
  fechaJornada: string
): ResultadoValidacionCarga {
  const problemas: ProblemaDeCarga[] = [];

  // La jornada abierta también pasa por el filtro: si ni esta es válida, no
  // tiene sentido validar las tarjetas contra ella.
  const lecturaJornada = interpretarFecha(fechaJornada);
  if (!lecturaJornada.iso) {
    return {
      ok: false,
      fechaIso: "",
      problemas: [
        {
          uid: "__jornada__",
          hipodromo: "(la jornada abierta)",
          carrera: "-",
          fechaEnPantalla: String(fechaJornada ?? ""),
          motivo: lecturaJornada.motivo ?? "La fecha de la jornada no es válida.",
          como: 'Elija la fecha de la jornada con el calendario (AAAA-MM-DD).',
        },
      ],
    };
  }
  if (lecturaJornada.ambigua) {
    return {
      ok: false,
      fechaIso: "",
      problemas: [
        {
          uid: "__jornada__",
          hipodromo: "(la jornada abierta)",
          carrera: "-",
          fechaEnPantalla: String(fechaJornada ?? ""),
          motivo: `Fecha ambigua: puede ser ${lecturaJornada.alternativas.join(" o ")}.`,
          como: "Elija la fecha con el calendario, que da el formato AAAA-MM-DD.",
        },
      ],
    };
  }
  const fechaIso = lecturaJornada.iso;

  for (const d of drafts) {
    const donde = `${String(d.hipodromo || "?").trim().toUpperCase()} C${String(d.carrera || "?").trim()}`;
    const crudo = d.fecha == null ? "" : String(d.fecha).trim();

    // Sin fecha en la tarjeta: se hereda la jornada. Es el caso normal (lo
    // normal es que la Gaceta no traiga fecha y el operador trabaja la
    // jornada que tiene abierta), así que NO es un problema.
    if (!crudo) continue;

    // Regla 1 + 2: tiene que interpretar, y no puede ser ambigua.
    const r = interpretarFecha(crudo);
    if (!r.iso) {
      problemas.push({
        uid: d.uid,
        hipodromo: String(d.hipodromo || "").trim().toUpperCase(),
        carrera: String(d.carrera || "").trim(),
        fechaEnPantalla: crudo,
        motivo: r.motivo ?? "La fecha no se puede interpretar.",
        como: "Corrija la fecha de la tarjeta (AAAA-MM-DD o DD/MM/AAAA).",
      });
      continue;
    }
    if (r.ambigua) {
      problemas.push({
        uid: d.uid,
        hipodromo: String(d.hipodromo || "").trim().toUpperCase(),
        carrera: String(d.carrera || "").trim(),
        fechaEnPantalla: crudo,
        motivo: `Es ambigua: "${crudo}" puede ser ${r.alternativas.join(" o ")}.`,
        como: 'Use el año primero (AAAA-MM-DD) para dejar claro el día y el mes.',
      });
      continue;
    }

    // Regla 4: a la base solo sale ISO estricto.
    if (!esFechaIso(r.iso)) {
      problemas.push({
        uid: d.uid,
        hipodromo: String(d.hipodromo || "").trim().toUpperCase(),
        carrera: String(d.carrera || "").trim(),
        fechaEnPantalla: crudo,
        motivo: `No se pudo dejar en ISO (quedó "${r.iso}").`,
        como: "Corrija la fecha de la tarjeta.",
      });
      continue;
    }

    // Regla 3: tiene que ser la jornada abierta.
    if (r.iso !== fechaIso) {
      problemas.push({
        uid: d.uid,
        hipodromo: String(d.hipodromo || "").trim().toUpperCase(),
        carrera: String(d.carrera || "").trim(),
        fechaEnPantalla: crudo,
        motivo: `Está fechada el ${r.iso}, pero la jornada abierta es el ${fechaIso}.`,
        como:
          `Corrija la fecha de ${donde} a ${fechaIso}, o cambie la jornada del ` +
          `encabezado si realmente es de otro día.`,
      });
    }
  }

  return { ok: problemas.length === 0, problemas, fechaIso };
}

/** Los problemas en una frase que se pueda leer en un toast. */
export function resumenProblemasCarga(
  problemas: ProblemaDeCarga[]
): string {
  if (!problemas.length) return "";
  const n = problemas.length;
  const plural = n > 1;
  const lineas = problemas.slice(0, 4).map((p) => {
    const d = `${p.hipodromo || "?"} C${p.carrera || "?"}`;
    return `${d}: ${p.motivo}`;
  });
  const extra = n > 4 ? ` (y ${n - 4} más)` : "";
  return (
    `No se ${plural ? "publicaron" : "publicó"} ${n} ` +
    `${plural ? "carreras" : "carrera"}${extra}. ${lineas.join(" ")}`
  );
}
