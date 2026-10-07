/**
 * WpsEngine — el motor de las jugadas AMERICANAS Winner / Place / Show.
 *
 * El legacy (`html/wps.html` + `js/wps.js`) llevaba esto en una tabla aparte,
 * `wps_tickets`, con su propio saldo y su propio pago. Eso era una segunda
 * contabilidad dentro del mismo club: los premios no pasaban por el motor de
 * la casa, ni por los reportes, ni por los cierres. Aqui la jugada es un
 * ticket normal (`tickets_apuestas` con `nombre_jugada` = "W", "P" o "S") y
 * este modulo solo aporta la MATRIZ de dividendos.
 *
 * LA MATRIZ. No es un unico dividendo por modalidad porque el pago depende de
 * las dos cosas a la vez: que se aposto W/P/S y en que puesto llego el
 * ejemplar. El legacy lo tenia asi (js/wps.js, seccion 3):
 *
 *        |  llega 1º   llega 2º   llega 3º
 *   -----+---------------------------------------
 *   W    |    WW        --         --
 *   P    |    WP        PP         --
 *   S    |    WS        PS         SS
 *
 * `—` = no paga (esa jugada se pierde).
 *
 * UNIDAD DE LOS DIVIDENDOS. El legacy guardaba el cuote americano tal como lo
 * imprime el tablero ("paga $6 POR $2") y calculaba `(monto / 2) * 6`. Aqui
 * TODOS los dividendos de `resultados_carreras.dividendos` son pago POR $1, que
 * es la convencion del resto del motor, asi que la clave guarda el equivalente
 * por $1: `wps_WW = 3` paga el mismo $30 sobre una jugada de $10 que el cuote
 * "6 por $2" del legacy. `pagoPorUno` hace esa conversion en la pantalla que
 * captura el resultado.
 *
 * La comision de la casa (5%) se aplica SOLO sobre la ganancia bruta, igual que
 * en tablas, nini y puestos: el legacy de WPS no cobraba nada, pero al entrar
 * al sistema unico tiene que comportarse como las demas modalidades.
 *
 * MODULO PURO: sin Supabase ni React, para que las pruebas lo compilen con el
 * mismo tsc que usa pruebas/run-marcas.ps1.
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA } from "../bettingEngine";
import { posicionesDePizarra } from "./puestos";

const TASA_DEFECTO = COMISION_CASA.rate * 100;

/** Lo que el operador aposto: gana, coloca o muestra. */
export type TipoWps = "W" | "P" | "S";

/**
 * Las 6 celdas de la matriz. Se guardan en `resultados_carreras.dividendos`
 * con el prefijo `wps_` porque "PP" sin calificar, en este proyecto, ya
 * significa PAREO y `win`/`puestos` ya son claves de otras modalidades.
 */
export type ClaveMatrizWps = "WW" | "WP" | "WS" | "PP" | "PS" | "SS";

export const PREFIJO_WPS = "wps_";

export const CLAVES_WPS: readonly ClaveMatrizWps[] = ["WW", "WP", "WS", "PP", "PS", "SS"];

/** Etiquetas de la matriz, para la pantalla que captura el resultado. */
export const ETIQUETAS_WPS: Record<ClaveMatrizWps, string> = {
  WW: "Gana y es 1º",
  WP: "Gana y es 1º (jugada P)",
  WS: "Gana y es 1º (jugada S)",
  PP: "Llega 2º y es Place (jugada P)",
  PS: "Llega 2º y es Place (jugada S)",
  SS: "Llega 3º y es Show (jugada S)",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convierte el cuote americano del tablero ("paga $6 por $2") al pago por $1
 * que espera el motor ($3). Ahi donde la casa captura el resultado se divide
 * entre 2 UNA sola vez, al guardar, y no en cada liquidacion.
 */
export function pagoPorUno(porDos: number): number {
  const n = Number(porDos);
  return Number.isFinite(n) && n > 0 ? round2(n / 2) : 0;
}

/**
 * Reconoce una jugada W/P/S. Solo coincidencia EXACTA a proposito: "PP" es
 * Pareo y "1P" es puesto puro, asi que un `/W|P|S/` laxo se comeria ambas
 * modalidades y las liquidaria con la matriz americana.
 */
export function tipoWps(tipoJugada: string): TipoWps | null {
  const t = String(tipoJugada ?? "").trim().toUpperCase();
  if (t === "W" || t === "WIN") return "W";
  if (t === "P" || t === "PLACE") return "P";
  if (t === "S" || t === "SHOW") return "S";
  return null;
}

/**
 * Celda de la matriz que corresponde a la jugada segun el puesto que logro el
 * ejemplar. `null` = la jugada no paga (llegada fuera del top 3, o una
 * combinacion que el hipodromo no liquida).
 */
export function claveMatrizWps(tipo: TipoWps, puesto: number | null): ClaveMatrizWps | null {
  if (puesto == null || !Number.isFinite(puesto) || puesto < 1) return null;
  if (tipo === "W") return puesto === 1 ? "WW" : null;
  if (tipo === "P") return puesto === 1 ? "WP" : puesto === 2 ? "PP" : null;
  return puesto === 1 ? "WS" : puesto === 2 ? "PS" : puesto === 3 ? "SS" : null;
}

/** Pago por $1 de una celda, o null si la casa todavia no la cargo. */
export function dividendoWps(
  dividendos: Record<string, number> | null | undefined,
  clave: ClaveMatrizWps | null
): number | null {
  if (!clave || !dividendos || typeof dividendos !== "object") return null;
  const n = Number(dividendos[PREFIJO_WPS + clave]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Liquida una jugada W/P/S.
 *
 * `null` = NO es una jugada WPS (delega en otro motor).
 *
 * `indeterminado` = el ejemplar ocurrio en el puesto que paga, pero la celda de
 * la matriz no esta cargada. NO se devuelve como perdida: la jugada queda
 * pendiente de que la casa registre los dividendos.
 */
export function liquidarWps(
  t: TicketMotor,
  tasaComision?: number | null
): ResultadoMotor | null {
  const tipo = tipoWps(t.tipo_jugada);
  if (!tipo) return null;

  const tasa =
    Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
      ? Number(tasaComision)
      : TASA_DEFECTO;

  const pizarra = t.pizarra;
  if (!pizarra || !String(pizarra.primero ?? "").trim()) {
    return {
      ok: false,
      indeterminado: true,
      motivo: `WPS ${tipo}: no hay resultado oficial de la carrera, la jugada sigue pendiente.`,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }

  const ejemplar = String(t.caballo ?? "").trim().toUpperCase();

  /* Sin ejemplar no se puede afirmar NADA: no hay forma de saber si la jugada
     gano o perdio. Se devuelve `indeterminado` y no una perdida. Importa
     porque la perdida queda PERSISTIDA (`saldos.ts` escribe estado='Perdedor' con
     premio 0) y liquidar de nuevo no lo revierte: un ticket mal capturado
     cobraba el stake entero y el operador no veia ningun error. */
  if (!ejemplar) {
    return {
      ok: false,
      indeterminado: true,
      motivo:
        `WPS ${tipo}: la jugada no tiene ejemplar registrado, asi que no se puede ` +
        `evaluar contra el resultado. Queda pendiente.`,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }

  const posiciones = posicionesDePizarra(pizarra);
  const puesto = posiciones.get(ejemplar) ?? null;
  const clave = claveMatrizWps(tipo, puesto);

  /* El ejemplar no esta en la pizarra. Puede ser que este retirado, que el
     operador lo haya tipeado mal, o que la pizarra este incompleta. No se
     puede distinguir solo desde aqui, y adivinar "perdida" cobra el stake sin
     aviso, asi que tambien queda pendiente. Si el Retiro fuera real, el
     operador lo resuelve viendo el ticket pendiente. */
  if (puesto == null) {
    return {
      ok: false,
      indeterminado: true,
      motivo:
        `WPS ${tipo}: el ejemplar ${ejemplar} no aparece en el resultado cargado ` +
        `(llego fuera del top 3, esta retirado, o hay que revisarlo). Queda pendiente, ` +
        `NO perdida.`,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }

  // El ejemplar llego pero la combinacion no liquida (p. ej. W que llega 2º).
  if (!clave) {
    return {
      ok: false,
      motivo: `WPS ${tipo} pierde: el ejemplar ${ejemplar} llego ${puesto}º y esa combinacion no paga.`,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }

  const mult = dividendoWps(t.dividendos, clave);
  if (mult == null) {
    return {
      ok: false,
      indeterminado: true,
      motivo:
        `WPS ${tipo} en el ejemplar ${ejemplar} (${puesto}º) pide el dividendo ` +
        `${PREFIJO_WPS}${clave}, que no esta cargado: la jugada queda pendiente, NO perdida.`,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }

  const bruto = round2(t.monto * mult);
  const gananciaBruta = bruto - t.monto;
  const comision = gananciaBruta > 0 ? round2(gananciaBruta * (tasa / 100)) : 0;
  return {
    ok: true,
    motivo:
      `WPS ${tipo} GANA (${clave}, ejemplar ${ejemplar} en ${puesto}º): ` +
      `$${t.monto} x ${mult}x = bruto $${round2(bruto)}` +
      (comision > 0 ? ` − comision casa $${round2(comision)}` : ""),
    totalClienteNeto: round2(bruto - comision),
    balanceBanca: round2(t.monto - bruto + comision),
    gananciaCasa: comision,
  };
}

export function procesarWps(t: TicketMotor): ResultadoMotor {
  return (
    liquidarWps(t) ?? {
      ok: false,
      motivo: "modalidad sin motor registrado: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    }
  );
}

registrarProcesador("W", procesarWps);
registrarProcesador("P", procesarWps);
registrarProcesador("S", procesarWps);
registrarProcesador("WIN", procesarWps);
registrarProcesador("PLACE", procesarWps);
registrarProcesador("SHOW", procesarWps);
