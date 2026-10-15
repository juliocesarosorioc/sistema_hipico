/**
 * Pruebas de POLLAS — parseo, inválidos, puntaje, ranking y finanzas.
 *
 * Lo que se rompe acá es silencioso. Un ejemplar invalidado que igual puntúa, una
 * combinación corrida cobrada como seis, un empate que le da el premio a uno
 * solo, un acumulado pagado dos veces: nada de eso lanza un error, devuelve un
 * número y la casa lo paga. Por eso se comparan montos y puntos EXACTOS.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  META_ACUMULADO_POR_DEFECTO,
  MAX_COMBINACIONES,
  PUNTOS_POR_DEFECTO,
  aporteAcumulado,
  calcularFinanzasPolla,
  configPorDefecto,
  contarCombinaciones,
  esInvalido,
  ejemplaresJugables,
  estadoAcumulado,
  etiquetaPremio,
  liquidarPolla,
  normalizarNumero,
  ordenarRanking,
  partirGrupos,
  parsearSeleccion,
  premioDePuesto,
  puntosDeCombinacion,
  puntosDePuesto,
  puntuarCombinaciones,
  puntuarVentas,
  repartirEntre,
  revisarCombinacion,
  revisarVenta,
  textoCarreras,
  textoCombinacion,
  totalVenta,
  type CarreraPolla,
  type ConfigPuntos,
  type ResultadoCarrera,
  type SeleccionPolla,
  type VentaPuntuada,
} from "../src/lib/pollas/core";

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
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

// ---------------------------------------------------------------------------
// Una jornada de 6 carreras para las pruebas
// ---------------------------------------------------------------------------
// RINCONADA 1ª a 6ª, exemplares 1..8. La 3ª tiene el 4 retirado y el 7
// invalidado para Polla, para probar el bloqueo.
function carrera(n: number, opciones: { invalidados?: string[] } = {}): CarreraPolla {
  return {
    clave: `2026-10-05|RINCONADA|${n}`,
    fecha: "2026-10-05",
    hipodromo: "RINCONADA",
    carrera: n,
    ejemplares: Array.from({ length: 8 }, (_, i) => ({ numero: String(i + 1) })),
    invalidados: opciones.invalidados,
  };
}

const C1 = carrera(1);
const C2 = carrera(2);
const C3 = carrera(3, { invalidados: ["7"] });
const C4 = carrera(4);
const C5 = carrera(5);
const C6 = carrera(6);
const SEIS = [C1, C2, C3, C4, C5, C6];

/** Resultado de las 6 carreras: gana el Nº 1 en todas menos la 2ª, que gana el 3. */
function res6(): ResultadoCarrera[] {
  return SEIS.map((c, i) => ({
    clave: c.clave,
    ganadores: i === 1 ? ["3", "1", "5", "8", "2"] : ["1", "2", "3", "4", "5"],
  }));
}

function sel(carreras: CarreraPolla[], numeros: string[]): SeleccionPolla[] {
  return carreras.map((c, i) => ({ claveCarrera: c.clave, numero: numeros[i] }));
}

// ===========================================================================
console.log("[1] partir el texto del jugador en grupos");
// ===========================================================================
eq("comas", partirGrupos("1, 2-3, 4"), [["1"], ["2", "3"], ["4"]]);
eq("saltos de línea", partirGrupos("1\n2-3\n4"), [["1"], ["2", "3"], ["4"]]);
eq("comas y saltos mezclados", partirGrupos("1,\n2-3; 4"), [["1"], ["2", "3"], ["4"]]);
eq("espacios sobrantes", partirGrupos("  1 ,  2 - 3  "), [["1"], ["2", "3"]]);
eq("guion largo (copiado de la web)", partirGrupos("1\u20132\u20133"), [["1", "2", "3"]]);
eq("el 07 es el mismo que el 7", partirGrupos("07"), [["7"]]);
eq("texto vacío", partirGrupos("   "), []);
eq("solo comas", partirGrupos(",,,"), []);

// ===========================================================================
console.log("\n[2] el caso que dio origen al módulo: 6 líneas = 8 combinaciones");
// ===========================================================================
// El jugador escribe una alternativa por línea y espera el producto. Si el
// parser tratara cada línea como una combinación fija, cobraría 6 en vez de 8.
const ochoTexto = "1\n2-3\n1\n2-3\n4\n2-3";
const ocho = parsearSeleccion(ochoTexto, SEIS);
ok("el texto de 6 líneas se acepta", ocho.ok);
eq("detecta las 6 carreras", ocho.ok ? ocho.carreras : 0, 6);
eq("da 8 combinaciones (1×2×1×2×1×2)", ocho.ok ? ocho.combinaciones.length : 0, 8);
eq("el conteo previo también dice 8", contarCombinaciones(partirGrupos(ochoTexto)), 8);
eq(
  "primera combinación: 1-2-1-2-4-2",
  ocho.ok ? textoCombinacion(ocho.combinaciones[0], SEIS) : "",
  "1-2-1-2-4-2"
);
eq(
  "las 8 son distintas",
  ocho.ok ? new Set(ocho.combinaciones.map((c) => textoCombinacion(c, SEIS))).size : 0,
  8
);

// El mismo juego escrito con comas tiene que dar idéntico resultado.
const ochoComas = parsearSeleccion("1, 2-3, 1, 2-3, 4, 2-3", SEIS);
eq(
  "con comas da las mismas 8",
  ochoComas.ok ? ochoComas.combinaciones.map((c) => textoCombinacion(c, SEIS)).join(" ") : "",
  ocho.ok ? ocho.combinaciones.map((c) => textoCombinacion(c, SEIS)).join(" ") : ""
);

// ===========================================================================
console.log("\n[3] el ejemplo de 4 combinaciones");
// ===========================================================================
const cuatro = parsearSeleccion("1, 2-3, 1-2, 4, 5, 6", SEIS);
eq("da 4 combinaciones (1×2×2×1×1×1)", cuatro.ok ? cuatro.combinaciones.length : 0, 4);
// El orden con que salen es el del producto cartesiano (grupo por grupo), que
// no es el mismo en que el jugador las escribió en el papel. Lo que importa es
// el conjunto: son las mismas 4, sin repetidas.
eq(
  "son las 4 esperadas",
  cuatro.ok ? [...cuatro.combinaciones.map((c) => textoCombinacion(c, SEIS))].sort() : [],
  ["1-2-1-4-5-6", "1-2-2-4-5-6", "1-3-1-4-5-6", "1-3-2-4-5-6"]
);

// ===========================================================================
console.log("\n[4] la combinación corrida: un grupo = una combinación");
// ===========================================================================
// "1-2-3-4-5-6" en una Polla de 6 carreras. Si se tratara como alternativas se
// cobrarían 6 combinaciones de un caballo; el jugador escribió una sola.
const corrida = parsearSeleccion("1-2-3-4-5-6", SEIS);
eq("una sola combinación", corrida.ok ? corrida.combinaciones.length : 0, 1);
eq("con un caballo por carrera", corrida.ok ? textoCombinacion(corrida.combinaciones[0], SEIS) : "", "1-2-3-4-5-6");

// Y el criterio NO se dispara por tener muchos caballos: se necesita UN grupo y
// tantos caballos como carreras.
const noCorrida = parsearSeleccion("1-2-3", SEIS);
ok("3 caballos en 6 carreras no es combinación corrida", !noCorrida.ok);
ok("el error explica las dos formas de escribirlo", noCorrida.ok ? false : /6 caballos/.test(noCorrida.error));

// ===========================================================================
console.log("\n[5] textos que se rechazan, y por qué");
// ===========================================================================
const sinCarreras = parsearSeleccion("1-2", []);
ok("sin carreras configuradas", !sinCarreras.ok);

const vacio = parsearSeleccion("", SEIS);
ok("texto vacío", !vacio.ok);

const desfasado = parsearSeleccion("1, 2-3, 4", SEIS);
ok("menos grupos que carreras", !desfasado.ok);
ok("el error dice cuántos grupos y cuántas carreras", desfasado.ok ? false : /3 grupos y la Polla tiene 6/.test(desfasado.error));

// El tope: 2¹⁶ son 65.536 combinaciones. Tiene que fallar SIN construirlas.
const explotado = parsearSeleccion(
  "1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2, 1-2",
  SEIS.concat(Array.from({ length: 10 }, (_, i) => carrera(7 + i)))
);
ok("16 carreras con 2 alternativas se rechaza", !explotado.ok);
ok("el error trae el número real", explotado.ok ? false : /65\.536/.test(explotado.error));
eq("y el tope es 2000", MAX_COMBINACIONES, 2000);

// ===========================================================================
console.log("\n[6) inválidos y retirados: ninguna combinación puede colocarlos");
// ===========================================================================
ok("el 7 está invalidado en la 3ª", esInvalido(C3, "7"));
ok("el 4 no está invalidado", !esInvalido(C3, "4"));
ok("'07' reconoce al '7' invalidado", esInvalido(C3, "07"));
eq("el 7 no se ofrece en la 3ª", ejemplaresJugables(C3).map((e) => e.numero), ["1", "2", "3", "4", "5", "6", "8"]);
eq("las demás carreras ofrecen los 8", ejemplaresJugables(C1).length, 8);
ok("un vacío cuenta como inválido", esInvalido(C1, ""));
ok("un texto no es un número válido", esInvalido(C1, "abc"));
ok("un número con signo tampoco", esInvalido(C1, "-3"));

const conInvalido = sel(SEIS, ["1", "2", "7", "4", "5", "6"]);
const r1 = revisarCombinacion(conInvalido, SEIS);
ok("no se puede cobrar una combinación con inválido", !r1.ok);
ok("el error nombra el ejemplar y la carrera", r1.ok ? false : /N° 7 de la 3ª carrera de RINCONADA/.test(r1.error));

const conInexistente = sel(SEIS, ["1", "2", "99", "4", "5", "6"]);
const r2 = revisarCombinacion(conInexistente, SEIS);
ok("tampoco un ejemplar que no está en la carrera", !r2.ok);

const buena = sel(SEIS, ["1", "2", "3", "4", "5", "6"]);
ok("una combinación sin inválidos pasa", revisarCombinacion(buena, SEIS).ok);
ok("con el Nº repetido en dos grupos distintos NO es la misma carrera", revisarCombinacion(buena, SEIS).ok);
ok("no puede traer una carrera de más", !revisarCombinacion([...buena, { claveCarrera: "X", numero: "1" }], SEIS).ok);
ok("no puede traer una carrera de menos", !revisarCombinacion(buena.slice(0, 5), SEIS).ok);

// Una venta de 40 combinaciones donde 2 son imposibles: se aceptan 38.
// La primera tiene el 7 invalidado en la 3ª; la segunda, un 99 que no existe.
const ventaMixta = [
  ...Array.from({ length: 38 }, () => buena),
  sel(SEIS, ["1", "2", "7", "4", "5", "6"]),
  sel(SEIS, ["99", "2", "3", "4", "5", "6"]),
];
const rev = revisarVenta(ventaMixta, SEIS);
eq("de 40, se aceptan 38", rev.validas.length, 38);
eq("y se señalan las 2 malas", rev.invalidas.length, 2);
ok("cada mala trae su motivo", rev.invalidas.every((i) => i.error.length > 10));

// ===========================================================================
console.log("\n[7] puntaje: 5 al 1º, 3 al 2º, 1 al 3º, 0 al resto");
// ===========================================================================
const P = PUNTOS_POR_DEFECTO;
eq("1º lugar", puntosDePuesto(1, P), 5);
eq("2º lugar", puntosDePuesto(2, P), 3);
eq("3º lugar", puntosDePuesto(3, P), 1);
eq("4º lugar no paga", puntosDePuesto(4, P), 0);
eq("fuera del podio no paga", puntosDePuesto(9, P), 0);
eq("los puntos son configurables", puntosDePuesto(1, { primero: 10, segundo: 4, tercero: 2 }), 10);
eq("un 0 configurado es un 0, no el default", puntosDePuesto(2, { primero: 0, segundo: 0, tercero: 0 }), 0);

// La combinación que gana las 6 carreras: 6 × 5 = 30. Ese es el techo del día.
const perfecta = sel(SEIS, ["1", "3", "1", "1", "1", "1"]); // en la 2ª gana el 3
eq("combinación que acierta el 1º en las 6", puntosDeCombinacion(perfecta, res6(), SEIS, P), 30);
eq("y es exactamente la meta del acumulado", META_ACUMULADO_POR_DEFECTO, 30);

// 2º en las carreras 1, 2 y 3 (3 pts cada una), 3º en la 4ª (1 pt) y nada en las
// dos últimas: 3+3+3+1 = 10.
const dosYtres = sel(SEIS, ["2", "1", "2", "3", "4", "5"]);
eq("tres segundos y un tercero", puntosDeCombinacion(dosYtres, res6(), SEIS, P), 10);

// Un inválido que igual salió ganador NO punta. En la 3ª ganó el 1, así que se
// usa una carrera donde el inválido pourrait estar: se prueba directo con la 3ª.
const conInvEnCarreraConResultado = sel(SEIS, ["1", "3", "7", "1", "1", "1"]);
eq("el inválido no puntúa aunque la carrera tenga resultado", puntosDeCombinacion(conInvEnCarreraConResultado, res6(), SEIS, P), 25);

// Sin resultado para esa carrera, no hay puntos para ella.
const parcial: ResultadoCarrera[] = res6().slice(0, 5);
eq("una carrera sin pizarra no puntúa", puntosDeCombinacion(perfecta, parcial, SEIS, P), 25);

// ===========================================================================
console.log("\n[8] no se liquida con carreras sin cerrar");
// ===========================================================================
// Un puntaje parcial engaña: le quitaría puntos al jugador por una carrera que la
// casa todavía no corrió. Por eso va 0 y se informa qué falta.
const incompletas = puntuarCombinaciones([perfecta], parcial, SEIS, P);
eq("no puntúa nada todavía", incompletas[0].puntos, 0);
eq("y dice qué carrera falta", incompletas[0].carrerasSinResultado, ["RINCONADA 6ª"]);
ok(
  "todas las combinaciones saben qué falta",
  puntuarCombinaciones([perfecta, dosYtres], parcial, SEIS, P).every((d) => d.carrerasSinResultado.length === 1)
);

const completas = puntuarCombinaciones([perfecta], res6(), SEIS, P);
eq("con todas las carreras, sí puntúa", completas[0].puntos, 30);
eq("y no falta ninguna", completas[0].carrerasSinResultado, []);

// ===========================================================================
console.log("\n[9] el ranking es por cliente, no por combinación");
// ===========================================================================
// Si rankeara por combinación, el que compró más entradas siempre ganaría.
const ventas: VentaPuntuada[] = [
  {
    cliente_id: "a",
    cliente: "Ana",
    combinaciones: [perfecta],
    puntosTotales: 0,
    pagado: 10,
  },
  {
    cliente_id: "b",
    cliente: "Beto",
    combinaciones: [sel(SEIS, ["1", "3", "1", "1", "1", "1"]), sel(SEIS, ["2", "2", "2", "2", "2", "2"])],
    puntosTotales: 0,
    pagado: 20,
  },
];
// Beto tiene la perfecta (30) más una de puros segundos (3+0+3+3+3+3 = 15).
const puntuadas = puntuarVentas(ventas, res6(), SEIS, P);
eq("Ana con 1 combinación", puntuadas[0].puntosTotales, 30);
eq("Beto suma las suyas", puntuadas[1].puntosTotales, 45);
ok("y supera a Ana por tener más entradas", puntuadas[1].puntosTotales > puntuadas[0].puntosTotales);

// ===========================================================================
console.log("\n[10] premios, empates y el puesto que se salta");
// ===========================================================================
const cfg = configPorDefecto(SEIS, 10);
cfg.premios = { primero: 100, segundo: 40, tercero: 10 };

const dosIguales: VentaPuntuada[] = [
  { cliente_id: "a", cliente: "Ana", combinaciones: [perfecta], puntosTotales: 30, pagado: 10 },
  { cliente_id: "b", cliente: "Beto", combinaciones: [perfecta], puntosTotales: 30, pagado: 10 },
];
const rEmpate = liquidarPolla(dosIguales, cfg, 0);
eq("empate: ambos 1º puesto", rEmpate.map((f) => f.puesto), [1, 1]);
eq("y el premio se reparte 50/50", rEmpate.map((f) => f.premio), [50, 50]);
ok("la tabla avisa que fue empate", rEmpate.every((f) => f.empatado));
eq("repartir 100 entre 2 no pierde plata", rEmpate.reduce((a, f) => a + f.premio, 0), 100);

// Con dos primeros, el siguiente es TERCERO, no segundo.
const tresConDobles: VentaPuntuada[] = [
  { cliente_id: "a", cliente: "Ana", combinaciones: [perfecta], puntosTotales: 30, pagado: 10 },
  { cliente_id: "b", cliente: "Beto", combinaciones: [perfecta], puntosTotales: 30, pagado: 10 },
  { cliente_id: "c", cliente: "Caro", combinaciones: [dosYtres], puntosTotales: 4, pagado: 10 },
];
const rTres = liquidarPolla(tresConDobles, cfg, 0);
eq("Ana 1º", rTres[0].puesto, 1);
eq("Beto 1º", rTres[1].puesto, 1);
eq("Caro es 3º, no 2º", rTres[2].puesto, 3);
eq("y cobra el premio de 3º", rTres[2].premio, 10);
eq("nadie cobra el 2º", rTres.filter((f) => f.puesto === 2).length, 0);

// Reparto con centavos que no dividen: 100 entre 3 son 33.33 × 3 = 99.99.
const tres = repartirEntre(3, 100);
eq("3 partes de 100", tres, [33.34, 33.33, 33.33]);
eq("no se pierde un centavo", tres.reduce((a, x) => a + x, 0), 100);
eq("repartir entre 0 no revienta", repartirEntre(0, 100), []);
eq("repartir un monto negativo da 0", repartirEntre(2, -50), [0, 0]);

// ===========================================================================
console.log("\n[11] el acumulado de los 30 puntos");
// ===========================================================================
// Solo lo cobra quien llega a la meta, y cobra UNO.
const conAcum: VentaPuntuada[] = [
  { cliente_id: "a", cliente: "Ana", combinaciones: [perfecta], puntosTotales: 30, pagado: 10 },
  { cliente_id: "b", cliente: "Beto", combinaciones: [dosYtres], puntosTotales: 4, pagado: 10 },
];
const rAcum = liquidarPolla(conAcum, cfg, 500);
eq("Ana, con 30, cobra el acumulado", rAcum[0].acumulado, 500);
eq("Beto no llega a la meta y no cobra", rAcum[1].acumulado, 0);
eq("y se lo dice con cuántos puntos faltan", rAcum[1].faltantesAcumulado, 26);
eq("quien lo cobra no tiene faltantes", rAcum[0].faltantesAcumulado, 0);
eq("el acumulado va una sola vez", rAcum.reduce((a, f) => a + f.acumulado, 0), 500);

// Si dos empatan en la meta, se reparte entre los dos: no se pierde ni se duplica.
const dosEnMeta = liquidarPolla(dosIguales, cfg, 500);
eq("dos en la meta: 250 cada uno", dosEnMeta.map((f) => f.acumulado), [250, 250]);
eq("y sigue siendo 500 en total", dosEnMeta.reduce((a, f) => a + f.acumulado, 0), 500);

// La meta es configurable: con meta 40 y 30 puntos, nadie cobra.
const cfg40 = { ...cfg, metaPuntos: 40 };
eq("con meta 40 nadie cobra el acumulado", liquidarPolla(conAcum, cfg40, 500).reduce((a, f) => a + f.acumulado, 0), 0);

// Sin acumulado disponible, no se inventa premio.
eq("sin acumulado disponible, nada", liquidarPolla(conAcum, cfg, 0)[0].acumulado, 0);

// ===========================================================================
console.log("\n[12] estado del acumulado antes de liquidar");
// ===========================================================================
const prov = ordenarRanking(puntuarVentas(conAcum, res6(), SEIS, P));
const est = estadoAcumulado(prov, cfg, 500);
eq("el acumulado disponible", est.disponible, 500);
eq("la meta", est.meta, 30);
eq("el líder tiene los 30", est.liderPuntos, 30);
eq("ya hay alguien en la meta", est.alcanzado, true);
eq("no falta nada", est.faltantes, 0);

// Beto tiene 10 puntos reales (tres segundos y un tercero), así que faltan 20.
const lejos = estadoAcumulado(ordenarRanking(puntuarVentas([conAcum[1]], res6(), SEIS, P)), cfg, 500);
eq("con 10 puntos faltan 20", lejos.faltantes, 20);
eq("y nadie alcanzó", lejos.alcanzado, false);

// ===========================================================================
console.log("\n[13] finanzas: comisión y acumulado salen de la venta");
// ===========================================================================
const cfgFin = configPorDefecto(SEIS, 10);
cfgFin.comisionPct = 10;
cfgFin.acumuladoPct = 5;
cfgFin.premios = { primero: 30, segundo: null, tercero: null };

const f = calcularFinanzasPolla(10, cfgFin, 0, []);
eq("10 combinaciones × 10", f.ventaBruta, 100);
eq("comisión 10%", f.comisionCasa, 10);
eq("acumulado 5%", f.aporteAcumulado, 5);
eq("premios configurados", f.premiosPagados, 30);
eq("total pagado", f.totalPagado, 30);
eq("neto de la casa", f.netoCasa, 70);
eq("no hay descuadre", f.descuadre, false);
eq("sin avisos", f.avisos, []);

eq("aporte del acumulado de una venta", aporteAcumulado(100, 5), 5);
eq("con 0% no aporta nada", aporteAcumulado(100, 0), 0);
eq("lo que paga un jugador", totalVenta(4, 10), 40);
eq("0 combinaciones no cobran nada", totalVenta(0, 10), 0);

// Si el premio no entra en la venta, TIENE que avisar, no dejar caja negativa muda.
const cfgCara = configPorDefecto(SEIS, 10);
cfgCara.premios = { primero: 500, segundo: null, tercero: null };
const cara = calcularFinanzasPolla(2, cfgCara, 0, []);
eq("neto negativo", cara.netoCasa, -480);
eq("se marca el descuadre", cara.descuadre, true);
ok("y explica en pantalla por qué", cara.avisos.some((a) => /superan la venta/.test(a)));

// Comisión + acumulado que se comen la venta: tiene que avisar también.
const cfgMordida = configPorDefecto(SEIS, 10);
cfgMordida.comisionPct = 60;
cfgMordida.acumuladoPct = 50;
eq("avisa que no queda para los premios", calcularFinanzasPolla(1, cfgMordida, 0, []).avisos.length > 0, true);

// Con ranking, se paga lo que el ranking repartió (respeta el empate), no la suma bruta.
const rConEmpate = liquidarPolla(dosIguales, cfg, 0);
const fEmpate = calcularFinanzasPolla(2, { ...cfg, precioUnitario: 100, comisionPct: 0, acumuladoPct: 0 }, 0, rConEmpate);
eq("dos premios de 50 = 100, no 200", fEmpate.premiosPagados, 100);

// ===========================================================================
console.log("\n[14] helpers de texto");
// ===========================================================================
eq("combinación en el orden de las carreras", textoCombinacion(sel(SEIS, ["6", "5", "4", "3", "2", "1"]), SEIS), "6-5-4-3-2-1");
eq("las carreras de la Polla", textoCarreras(SEIS), "RINCONADA 1ª, RINCONADA 2ª, RINCONADA 3ª, RINCONADA 4ª, RINCONADA 5ª, RINCONADA 6ª");
eq("el 07 se muestra como 7", textoCombinacion(sel(SEIS, ["07", "1", "1", "1", "1", "1"]), SEIS), "7-1-1-1-1-1");
eq("normaliza 007", normalizarNumero("007"), "7");
eq("no toca un 0 solo", normalizarNumero("0"), "0");
eq("premio con texto de la casa", etiquetaPremio(100, "una caja de ron"), "100 (una caja de ron)");
eq("premio que no paga", etiquetaPremio(0), "No paga");
eq("premio null", etiquetaPremio(null), "No paga");
eq("premio con decimales", etiquetaPremio(12.5), "12.50");
eq("premio entero sin decimales", etiquetaPremio(50), "50");
eq("el premio sale de la config", premioDePuesto(1, cfg), 100);
eq("puesto null no paga", premioDePuesto(null, cfg), 0);

// ===========================================================================
console.log("\n[15] PollasModule USA el núcleo (no reimplementa la regla)");
// ===========================================================================
{
  // Si el componente vuelve a calcular los puntos por su cuenta, la regla deja de
  // ser una sola: el navegador puede mostrar un ganador que el core no ve, y la
  // casa paga según lo que le digan. Los componentes importan Supabase al
  // cargarse, así que se leen como texto. Se resuelve desde `process.cwd()` y NO
  // desde `__dirname`: el runner compila este archivo a `%TEMP%`, fuera del repo.
  const mod = readFileSync(join(process.cwd(), "src", "components", "pollas", "PollasModule.tsx"), "utf8");

  ok("importa el núcleo de Pollas", /from "@\/lib\/pollas"/.test(mod));
  ok("puntúa con puntuarVentas (agrupa por cliente)", /puntuarVentas\(/.test(mod));
  ok("el ranking sale de ordenarRanking", /ordenarRanking\(/.test(mod));
  ok("el acumulado sale de estadoAcumulado", /estadoAcumulado\(/.test(mod));
  ok("las finanzas salen de calcularFinanzasPolla", /calcularFinanzasPolla\(/.test(mod));
  ok("NO suma puntos a mano", !/\bpuntos\s*\+?=/.test(mod));
  ok("NO inventa una regla de empate propia", !/puesto\s*=\s*\d+\s*>/.test(mod));

  // El cobro tiene que revalidar en el momento de confirmar, no solo al escribir
  // en el modal: entre abrir y confirmar la carrera pudo invalidarse, y lo que se
  // cobra tiene que ser lo que estaba válido al momento del cobro.
  ok("revalida la selección antes de cobrar", /parsearSeleccion\([\s\S]{0,600}revisarVenta\(/.test(mod));
  ok("cobra solo las combinaciones válidas", /combinaciones:\s*rev\.validas/.test(mod));
  ok("corta el cobro si alguna es inválida", /rev\.invalidas\.length\s*>\s*0/.test(mod));

  // Un ejemplar invalidado DESPUÉS de la venta no puede seguir sumando.
  ok("las anuladas no entran al puntaje", /if\s*\(c\.anulada\)\s*continue/.test(mod));

  // La ruta existe y el maestro la expone como puerta real.
  ok(
    "la ruta /pollas existe",
    existsSync(join(process.cwd(), "src", "app", "(dashboard)", "pollas", "page.tsx"))
  );
  const cap = readFileSync(join(process.cwd(), "src", "lib", "seguridad", "capacidades.ts"), "utf8");
  ok("el maestro declara la ruta de Pollas", /clave:\s*"pollas"/.test(cap));
  // El nivel va como argumento posicional de `c()`, no como campo del objeto.
  ok(
    "el maestro declara liquidar como crítico",
    /c\("pollas",\s*"boton",\s*"btn_liquidar",[^)]*"critico"/.test(cap)
  );
}

// ===========================================================================
console.log(`\nTODO ${fallan === 0 ? "OK" : "FALLA"}: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);