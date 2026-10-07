// ============================================================================
// Pruebas del motor de jugadas AMERICANAS Winner / Place / Show.
//
// W/P/S es la modalidad donde el pago depende de DOS cosas a la vez: que se
// aposto W, P o S, y en que puesto llego el ejemplar. Por eso usa una matriz
// (wps_WW/wps_WP/wps_WS/wps_PP/wps_PS/wps_SS) en vez de una clave de
// dividendo por modalidad como el resto del motor.
//
// Lo que se protege aqui, en orden de importancia:
//   1. Que la matriz sea la del legacy (js/wps.js seccion 3). Un W que llega 2º
//      NO paga, y un P que llega 2º paga la celda PP, no la WP.
//   2. Que "PP" (pareo) y "1P" (puesto puro) NO entren al motor americano:
//      el reconocimiento es exacto justamente por esto.
//   3. Que una jugada que GANA por posicion sin dividendo cargado quede
//      INDETERMINADA, no perdida. Perderla cobra $0 a un ganador y escribe el
//      estado "Perdedor" en la base, que ya no se revierte solo.
//
// Corre con pruebas/run-marcas.ps1
// ============================================================================
import { liquidarWps, tipoWps, claveMatrizWps, dividendoWps, pagoPorUno, PREFIJO_WPS } from "../src/lib/motores/wps";
import { liquidarOficial } from "../src/lib/motores/oficiales";
import type { TicketMotor } from "../src/lib/bettingEngine";
import type { PizarraCarrera } from "../src/lib/liquidacion";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? "\n         " + detalle : ""}`);
  }
}

/** Pizarra: 4 llega, 7 gana, 2 segundo, 3 tercero. */
const PIZARRA: PizarraCarrera = {
  primero: "7",
  segundo: "2",
  tercero: "3",
  cuarto: "4",
  quinto: "5",
  sexto: "6",
  septimo: "8",
  octavo: "9",
};

function ticket(tipo: string, caballo: string, monto = 10, dividendos: Record<string, number> | null = null): TicketMotor {
  return {
    hipodromo: "H1",
    carrera: "1",
    tipo_jugada: tipo,
    caballo,
    fechas: [],
    id: "wps-test",
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    monto,
    puesto_final: 1,
    pizarra: PIZARRA,
    dividendos,
  };
}

/** Matriz completa: la casa cargo "paga 12 por $2" (6x) en todas las celdas. */
const MATRIZ_6X: Record<string, number> = {
  [PREFIJO_WPS + "WW"]: 6,
  [PREFIJO_WPS + "WP"]: 5,
  [PREFIJO_WPS + "WS"]: 4,
  [PREFIJO_WPS + "PP"]: 3,
  [PREFIJO_WPS + "PS"]: 2,
  [PREFIJO_WPS + "SS"]: 1,
};

// ---------------------------------------------------------------------------
console.log("\n-- El tablero americano cotiza POR $2; el motor guarda POR $1");
eq("6 por $2 son 3 por $1", pagoPorUno(6), 3);
eq("10 por $2 son 5 por $1", pagoPorUno(10), 5);
eq("0 no es un dividendo", pagoPorUno(0), 0);
eq("basura no es un dividendo", pagoPorUno(NaN), 0);
eq("3.50 por $2 son 1.75 por $1", pagoPorUno(3.5), 1.75);

console.log("\n-- Solo W, P y S son americanas (PP es Pareo y 1P es puesto puro)");
eq("W", tipoWps("W"), "W");
eq("P", tipoWps("P"), "P");
eq("S", tipoWps("S"), "S");
eq("WIN", tipoWps("win"), "W");
eq("PLACE", tipoWps("Place"), "P");
eq("SHOW", tipoWps("SHOW"), "S");
eq("espacios", tipoWps("  w  "), "W");
// Estas cuatro son la regresion que justifican el reconocimiento EXACTO.
eq("PP NO es Place", tipoWps("PP"), null);
eq("1P NO es Place", tipoWps("1P"), null);
eq("2P NO es Place", tipoWps("2P"), null);
eq("vacio", tipoWps(""), null);
eq("nada", tipoWps("GANADOR"), null);
eq("undefined", tipoWps(undefined as unknown as string), null);

console.log("\n-- La matriz es la del legacy: WW/WP/WS arriba, PP/PS/SS al pie");
eq("W 1º -> WW", claveMatrizWps("W", 1), "WW");
eq("W 2º -> no paga", claveMatrizWps("W", 2), null);
eq("W 3º -> no paga", claveMatrizWps("W", 3), null);
eq("P 1º -> WP", claveMatrizWps("P", 1), "WP");
eq("P 2º -> PP", claveMatrizWps("P", 2), "PP");
eq("P 3º -> no paga", claveMatrizWps("P", 3), null);
eq("S 1º -> WS", claveMatrizWps("S", 1), "WS");
eq("S 2º -> PS", claveMatrizWps("S", 2), "PS");
eq("S 3º -> SS", claveMatrizWps("S", 3), "SS");
eq("S 4º -> no paga", claveMatrizWps("S", 4), null);
eq("fuera de pizarra", claveMatrizWps("W", null), null);
eq("puesto 0", claveMatrizWps("W", 0), null);

console.log("\n-- El prefijo evita chocar con el Pareo y las otras modalidades");
ok("las 6 claves se leen del lado de la casa", dividendoWps(MATRIZ_6X, "WS") === 4);
eq("una clave sin cargar no inventa pago", dividendoWps(MATRIZ_6X, null), null);
eq("sin dividendos no hay pago", dividendoWps(null, "WW"), null);
eq("una clave en 0 no paga", dividendoWps({ wps_WW: 0 }, "WW"), null);
// El riesgo concreto: "PP" es una clave real de la matriz americana y tambien
// el nombre de la modalidad Pareo. Sin prefijo, una clave "PP" de Pareo seria
// leida como el dividendo del 2º lugar de una jugada Place.
eq("el Pareo no se lee como celda Place", dividendoWps({ PP: 99 }, "PP"), null);
eq("una clave americana no pisa 'puestos'", dividendoWps({ puestos: 99 }, "WW"), null);

// ---------------------------------------------------------------------------
console.log("\n-- El W que llega 1º cobra el dividendo de la celda WW");
const wGanador = liquidarWps(ticket("W", "7", 10, MATRIZ_6X));
ok("gana", wGanador?.ok === true);
// 10 x 6 = 60 bruto; ganancia bruta 50; comision 5% = 2.5; neto 57.5
eq("bruto 10 x 6", 10 * 6, 60);
eq("comision 5% sobre la ganancia bruta", wGanador?.gananciaCasa, 2.5);
eq("el cliente recibe bruto menos comision", wGanador?.totalClienteNeto, 57.5);
eq("el balance de la casa es el inverso", wGanador?.balanceBanca, -47.5);
ok("no es indeterminado", wGanador?.indeterminado !== true);

console.log("\n-- Cada celda paga segun el puesto real del ejemplar");
// El 2º llega 2º: un P cobra PP (3x) y un S cobra PS (2x). Sobre $10:
//   PP -> bruto 30, ganancia 20, comision 1.00, neto 29
//   PS -> bruto 20, ganancia 10, comision 0.50, neto 19.50
const pSegundo = liquidarWps(ticket("P", "2", 10, MATRIZ_6X));
eq("P en 2º paga la celda PP (3x)", pSegundo?.totalClienteNeto, 29);
const sSegundo = liquidarWps(ticket("S", "2", 10, MATRIZ_6X));
eq("S en 2º paga la celda PS (2x)", sSegundo?.totalClienteNeto, 19.5);
// El 3º llega 3º: solo el S paga (SS = 1x, o sea a la par, sin ganancia).
const sTercero = liquidarWps(ticket("S", "3", 10, MATRIZ_6X));
eq("S en 3º paga la celda SS (1x)", sTercero?.totalClienteNeto, 10);
eq("a la par no hay comision", sTercero?.gananciaCasa, 0);
// El que gana paga SIEMPRE la celda de la fila W, no la de su lugar:
//   WS (4x) -> bruto 40, ganancia 30, comision 1.50, neto 38.50
//   WP (5x) -> bruto 50, ganancia 40, comision 2.00, neto 48.00
const sGanador = liquidarWps(ticket("S", "7", 10, MATRIZ_6X));
eq("S en 1º paga WS (4x)", sGanador?.totalClienteNeto, 38.5);
const pGanador = liquidarWps(ticket("P", "7", 10, MATRIZ_6X));
eq("P en 1º paga WP (5x)", pGanador?.totalClienteNeto, 48);

console.log("\n-- Un W que no gana se pierde de verdad (no es dato faltante)");
const wTercero = liquidarWps(ticket("W", "3", 10, MATRIZ_6X));
ok("pierde", wTercero?.ok === false);
ok("y NO es indeterminado", wTercero?.indeterminado !== true);
eq("no paga nada", wTercero?.totalClienteNeto, 0);
eq("el monto entra a la casa", wTercero?.balanceBanca, 10);

console.log("\n-- Un P en 3º pierde: Place no paga Show (son celdas distintas)");
const pTercero = liquidarWps(ticket("P", "3", 10, MATRIZ_6X));
ok("pierde", pTercero?.ok === false);
eq("y la casa se lleva los $10", pTercero?.balanceBanca, 10);

console.log("\n-- SIN DIVIDENDO, LA JUGADA QUEDA PENDIENTE (nunca perdida)");
// Este es el caso que motivates el campo `indeterminado`: en produccion las
// carreras cargadas NO tienen dividendos, asi que sin esto una jugada W
// ganadora se guardaba como "Perdedor" con premio 0 de forma permanente.
const wSinDiv = liquidarWps(ticket("W", "7", 10, null));
ok("no se declara perdida", wSinDiv?.ok === false);
ok("se marca indeterminado", wSinDiv?.indeterminado === true);
eq("no se paga nada todavia", wSinDiv?.totalClienteNeto, 0);
eq("y el saldo NO se mueve a la casa", wSinDiv?.balanceBanca, 0);
ok("el motivo dice que falta el dividendo", /dividendo/i.test(wSinDiv?.motivo ?? ""));

console.log("\n-- SIN EJEMPLAR NO SE PUEDE AFIRMAR QUE PERDIÓ (queda pendiente)");
/* El segundo bug del mismo tipo que el dividendo faltante, y más peligroso:
   con `caballo` vacío, `posicionesDePizarra(...).get("")` daba undefined, el motor
   lo tomaba como "el ejemplar no llegó al top 3" y devolvía una PÉRDIDA con
   balanceBanca = monto. `saldos.ts` persistía estado='Perdedor' con premio 0, que
   no se revierte al liquidar de nuevo: la casa se quedaba el stake entero de una
   jugada que sí podía haber ganado, y el operador no veía ningún error.

   No se puede distinguir desde el motor si el ejemplar esta retirado, si la
   pizarra quedo a medias o si el operador se equivoco de numero, asi que
   tampoco se cobra como perdida. La pizarra de test va 7,2,3,4,5,6,8,9: el
   caballo 1 no aparece nunca. */
const sinCaballo = liquidarWps(ticket("W", "", 10, MATRIZ_6X));
ok("no se declara perdida", sinCaballo?.ok === false);
ok("se marca indeterminado", sinCaballo?.indeterminado === true);
eq("no se paga nada todavia", sinCaballo?.totalClienteNeto, 0);
eq("y el saldo NO se mueve a la casa", sinCaballo?.balanceBanca, 0);
ok("el motivo habla del ejemplar", /ejemplar/i.test(sinCaballo?.motivo ?? ""));

const caballoInexistente = liquidarWps(ticket("P", "1", 10, MATRIZ_6X));
ok("un ejemplar ausente de la pizarra tampoco es perdida", caballoInexistente?.indeterminado === true);
eq("y tampoco mueve el saldo", caballoInexistente?.balanceBanca, 0);
ok(
  "el motivo dice que hay que revisarlo",
  /retirado|revisarlo|fuera del top 3/i.test(caballoInexistente?.motivo ?? "")
);

console.log("\n-- Matriz a medias: solo se traba la celda que falta");
const matrizParcial = { wps_WW: 6, wps_WS: 4 };
const wwCargada = liquidarWps(ticket("W", "7", 10, matrizParcial));
ok("la celda cargada se liquida", wwCargada?.ok === true);
const ssFaltante = liquidarWps(ticket("S", "3", 10, matrizParcial));
ok("la celda sin cargar queda pendiente", ssFaltante?.indeterminado === true);
ok("y no como perdida", ssFaltante?.ok === false);

console.log("\n-- Sin pizarra oficial no se decide nada");
const sinPizarra = liquidarWps({ ...ticket("W", "7", 10, MATRIZ_6X), pizarra: { primero: "" } });
ok("queda pendiente", sinPizarra?.indeterminado === true);
eq("ni se cobra ni se pierde", sinPizarra?.balanceBanca, 0);

console.log("\n-- El monto se respeta: no es un premio fijo");
// $1 x 6 -> bruto 6, ganancia 5, comision 0.25, neto 5.75
eq("$1 x 6", liquidarWps(ticket("W", "7", 1, MATRIZ_6X))?.totalClienteNeto, 5.75);
// $100 x 6 -> bruto 600, ganancia 500, comision 25, neto 575
eq("$100 x 6", liquidarWps(ticket("W", "7", 100, MATRIZ_6X))?.totalClienteNeto, 575);

// ---------------------------------------------------------------------------
console.log("\n-- liquidarOficial deriva W/P/S al motor americano");
const oficialW = liquidarOficial(ticket("W", "7", 10, MATRIZ_6X));
eq("mismo resultado que liquidarWps", oficialW.totalClienteNeto, wGanador?.totalClienteNeto);
const oficialS = liquidarOficial(ticket("S", "2", 10, MATRIZ_6X));
eq("S en 2º por el router oficial", oficialS.totalClienteNeto, 19.5);
// La comision se puede acotar por carrera (mismo criterio que tablas y puestos).
const oficialComision = liquidarOficial(ticket("W", "7", 10, MATRIZ_6X), 10);
eq("al 10% la comision es 5", oficialComision.gananciaCasa, 5);

console.log("\n-- REGRESION: las modalidades de puestos siguen intactas");
// Si el motor americano se comiera "1P" o "PP", estas dos aserciones
// son las que avisan.
const puestoPuro = liquidarOficial(ticket("1P", "7", 10, MATRIZ_6X));
ok("1P lo resuelve el motor de puestos", puestoPuro.motivo !== undefined);
ok("1P no pide ningun dividendo wps_", !/wps_/.test(puestoPuro.motivo ?? ""));
const nini = liquidarOficial(ticket("2N", "7", 10, MATRIZ_6X));
ok("2N no pide ningun dividendo wps_", !/wps_/.test(nini.motivo ?? ""));

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan) process.exit(1);
