// Pruebas de la jerarquia posicional y de la matematica 120/100.
// Modulo PURO a proposito: jerarquia.ts no importa Supabase ni React, asi que
// node lo corre directo con type-stripping (node >= 22.6). Sin el separador
// "type" de TS para que el archivo sea ejecutable tal cual.
import {
  calcularRivales,
  calcularMonto,
  separarNumeros,
  simularMarca,
  parsearOrden,
} from "../src/lib/marcas/jerarquia";

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

// ---------------------------------------------------------------------------
console.log("\n[1] separarNumeros");
// ---------------------------------------------------------------------------
eq("divide por slash", separarNumeros("1/2/3/4/5"), ["1", "2", "3", "4", "5"]);
eq("recorta espacios", separarNumeros(" 1 / 2 /3 "), ["1", "2", "3"]);
eq("descarta segmentos vacios", separarNumeros("1//2/"), ["1", "2"]);
eq("vacio -> lista vacia", separarNumeros(""), []);
eq("null -> lista vacia", separarNumeros(null), []);

// ---------------------------------------------------------------------------
console.log("\n[2] REGLA 1 — bloqueo NV");
// ---------------------------------------------------------------------------
eq("6 es NV", calcularRivales("6", "1/2/3/4/5", "6/7/8").valido, false);
eq("8 es NV", calcularRivales("8", "1/2/3/4/5", "6/7/8").valido, false);
eq("9 no es NV (puede jugar)", calcularRivales("9", "1/2/3/4/5", "6/7/8").valido, true);
eq(
  "el mensaje NV lo dice",
  /NV/.test(calcularRivales("6", "1/2/3/4/5", "6/7/8").mensaje),
  true
);

// ---------------------------------------------------------------------------
console.log("\n[3] REGLA 2 — el que no es marca se mide contra las marcas, de a uno");
// ---------------------------------------------------------------------------
{
  const a = calcularRivales("9", "1/2/3/4/5", "6/7/8");
  eq("9 es valido", a.valido, true);
  eq("las 5 marcas son candidatos", a.candidatos, ["1", "2", "3", "4", "5"]);
  eq("pero el match es contra UNO", a.rival, "1");
  eq("sin rival elegido se avisa", a.rivalElegido, false);
}
{
  const a = calcularRivales("10", "1/2", "6");
  eq("10 tiene 1 y 2 de candidatos", a.candidatos, ["1", "2"]);
  eq("y se mide contra el primero", a.rival, "1");
}
{
  const a = calcularRivales("9", "", "");
  eq("sin marcas no se puede jugar", a.valido, false);
}

// ---------------------------------------------------------------------------
console.log("\n[4] REGLA 4 — el primer favorito esta bloqueado");
// ---------------------------------------------------------------------------
{
  const a = calcularRivales("1", "1/2/3/4/5", "6/7/8");
  eq("el 1 no puede jugar", a.valido, false);
  eq("sin candidatos", a.candidatos, []);
  eq("y sin rival", a.rival, null);
  eq("el mensaje lo explica", /primer favorito/.test(a.mensaje), true);
}
{
  // Si el 1 no fuera el primero de la lista, la regla cambia.
  // "5/1/3": el 3 está en índice 2, así que todo lo que está a su izquierda
  // son el 5 Y el 1 (no solo el 5: el orden intermedio también cuenta).
  const a = calcularRivales("3", "5/1/3", "");
  eq("el 1 en 2do lugar si juega", a.valido, true);
  eq("contra el 5 y el 1", a.candidatos, ["5", "1"]);
}

// ---------------------------------------------------------------------------
console.log("\n[5] REGLA 3 — jerarquia interna");
// ---------------------------------------------------------------------------
{
  const a = calcularRivales("5", "1/2/3/4/5", "6/7/8");
  eq("marca 5 es valida", a.valido, true);
  eq("el 5 se mide contra 1,2,3,4", a.candidatos, ["1", "2", "3", "4"]);
}
{
  const a = calcularRivales("3", "1/2/3/4/5", "6/7/8");
  eq("marca 3 contra 1,2", a.candidatos, ["1", "2"]);
}
{
  const a = calcularRivales("2", "1/2/3/4/5", "6/7/8");
  eq("marca 2 contra 1", a.candidatos, ["1"]);
}
{
  const a = calcularRivales("4", "1/2/3/4/5", "");
  eq("marca 4 contra 1,2,3", a.candidatos, ["1", "2", "3"]);
}
{
  // El orden de la lista ES la jerarquia: 4 antes que 2 cambia los rivales.
  const a = calcularRivales("2", "1/4/2/3", "");
  eq("si el orden cambia, cambian los candidatos", a.candidatos, ["1", "4"]);
}

// ---------------------------------------------------------------------------
console.log("\n[5b] EL RIVAL — de a uno, y nunca izquierda contra derecha");
// ---------------------------------------------------------------------------
// Marcas "4/7/2": el 4 es la punta de la izquierda y el 2 el de la derecha.
{
  const a = calcularRivales("2", "4/7/2", "", "", true, "7");
  eq("el operador elige al 7", a.rival, "7");
  eq("y queda marcado como elegido", a.rivalElegido, true);
  eq("los candidatos no cambian por elegir", a.candidatos, ["4", "7"]);
}
{
  const a = calcularRivales("2", "4/7/2", "", "", true, "4");
  eq("el 4 si es legal: esta a la izquierda", a.rival, "4");
}
{
  // El cruce prohibido por norma: el 4 no puede medirse contra el 7.
  const a = calcularRivales("4", "4/7/2", "", "", true, "7");
  eq("el 4 no puede jugarse en punta", a.valido, false);
}
{
  // El 7 SI puede jugarse, pero no contra el 2: el 2 esta a su derecha.
  const a = calcularRivales("7", "4/7/2", "", "", true, "2");
  eq("contra el 2 se cae a un legal", a.rival, "4");
  eq("y avisa que la eleccion no se respeto", a.rivalElegido, false);
}
{
  const a = calcularRivales("7", "4/7/2", "6", "", true, "6");
  eq("un NV no puede ser rival", a.rival, "4");
  eq("y avisa", a.rivalElegido, false);
}
{
  const a = calcularRivales("7", "4/7/2", "6/8", "", true, "8");
  eq("tampoco un numero que no esta en la carrera", a.rival, "4");
}
{
  const a = calcularRivales("9", "4/7/2", "6", "", true, "");
  eq("un caballo fuera de la marca se mide contra la que sea", a.candidatos, ["4", "7", "2"]);
}
{
  // Un caballo nunca puede ser su propio rival, aunque se le pida.
  const a = calcularRivales("2", "4/7/2", "", "", true, "2");
  eq("el 2 no aparece en su propia lista", a.candidatos.includes("2"), false);
}

// ---------------------------------------------------------------------------
console.log("\n[6] entradas vacias");
// ---------------------------------------------------------------------------
eq("sin caballo no hay analisis", calcularRivales("", "1/2", "").valido, false);
eq("espacios tampoco", calcularRivales("   ", "1/2", "").valido, false);

// ---------------------------------------------------------------------------
console.log("\n[7] matematica 120/100");
// ---------------------------------------------------------------------------
eq("100 -> ganancia 83.33", calcularMonto(100), { monto: 100, gananciaNeta: 83.33, pagoBruto: 183.33 });
eq("120 -> ganancia 100", calcularMonto(120), { monto: 120, gananciaNeta: 100, pagoBruto: 220 });
eq("60 -> ganancia 50", calcularMonto(60), { monto: 60, gananciaNeta: 50, pagoBruto: 110 });
eq("bruto = monto * 220/120", calcularMonto(1000).pagoBruto, 1833.33);
eq("acepta string", calcularMonto("250").gananciaNeta, 208.33);
eq("monto 0", calcularMonto(0).pagoBruto, 0);

// La ganancia siempre es el 100/120, y el bruto la suma:
//   100 * 100/120 = 83.333...  -> 83.33
//   83.33 + 100    = 183.33
eq("ganancia = monto * 100/120", Math.round(calcularMonto(120).monto * (100 / 120) * 100) / 100, 100);

// ---------------------------------------------------------------------------
console.log("\n[8] simulacion de liquidacion contra orden de llegada");
// ---------------------------------------------------------------------------
{
  // El caso real de la casa: la jugada es de a UNO. El 5 se midio contra el 3.
  const orden = [
    { numero: "5", puesto: 1 },
    { numero: "3", puesto: 4 },
    { numero: "1", puesto: 2 },
    { numero: "2", puesto: 3 },
  ];
  const r = simularMarca("5", ["3"], orden);
  eq("gana beating a su unico rival", r.gana, true);
  eq("y lo dice con el rival", /Gana a su rival 3/.test(r.motivo), true);
}
{
  // Mismo rival, pero llego por delante.
  const orden = [
    { numero: "3", puesto: 1 },
    { numero: "5", puesto: 2 },
    { numero: "1", puesto: 3 },
    { numero: "2", puesto: 4 },
  ];
  const r = simularMarca("5", ["3"], orden);
  eq("con su rival por delante pierde", r.gana, false);
  eq("y lo dice", /Pierde: su rival 3/.test(r.motivo), true);
}
{
  // Gana aunque otro caballo llegue antes: si no es su rival, no importa.
  const orden = [
    { numero: "1", puesto: 1 },
    { numero: "5", puesto: 2 },
    { numero: "3", puesto: 3 },
    { numero: "2", puesto: 4 },
  ];
  const r = simularMarca("5", ["3"], orden);
  eq("un tercero por delante no lo tumba", r.gana, true);
}
{
  // El 5 juega contra 1,2,3,4. Llega 1ro -> gana.
  const orden = [
    { numero: "5", puesto: 1 },
    { numero: "1", puesto: 2 },
    { numero: "2", puesto: 3 },
    { numero: "3", puesto: 4 },
    { numero: "4", puesto: 5 },
  ];
  const r = simularMarca("5", ["1", "2", "3", "4"], orden);
  eq("el 5 delante de todos gana", r.gana, true);
  eq("y su puesto es 1", r.puesto, 1);
}
{
  // El 5 llega 3ro, con el 1 por delante -> pierde.
  const orden = [
    { numero: "1", puesto: 1 },
    { numero: "3", puesto: 2 },
    { numero: "5", puesto: 3 },
    { numero: "2", puesto: 4 },
    { numero: "4", puesto: 5 },
  ];
  const r = simularMarca("5", ["1", "2", "3", "4"], orden);
  eq("con un rival por delante pierde", r.gana, false);
  eq("y lo dice", /Pierde/.test(r.motivo), true);
}
{
  // Gana por poco: solo necesita estar delante de TODOS los suyos.
  const orden = [
    { numero: "5", puesto: 2 },
    { numero: "1", puesto: 3 },
    { numero: "2", puesto: 4 },
    { numero: "3", puesto: 5 },
  ];
  const r = simularMarca("5", ["1", "2", "3"], orden);
  eq("2do lugar pero delante de sus 3 rivales gana", r.gana, true);
}
{
  // Un rival que no llegó: no se puede afirmar la victoria.
  const orden = [
    { numero: "5", puesto: 1 },
    { numero: "1", puesto: 2 },
    { numero: "2", puesto: 3 },
  ];
  const r = simularMarca("5", ["1", "2", "3", "4"], orden);
  eq("rival ausente -> no se confirma", r.gana, false);
  eq("y avisa", /no figura/.test(r.motivo), true);
}
{
  // El caballo jugado no aparece en el orden de llegada.
  const r = simularMarca("9", ["1", "2"], [{ numero: "1", puesto: 1 }, { numero: "2", puesto: 2 }]);
  eq("el jugador ausente es error, no victoria", r.gana, false);
}

// ---------------------------------------------------------------------------
console.log("\n[9] parsearOrden: lo que escribe el operador");
// ---------------------------------------------------------------------------
eq("comas", parsearOrden("5, 1, 3, 2"), [
  { numero: "5", puesto: 1 },
  { numero: "1", puesto: 2 },
  { numero: "3", puesto: 3 },
  { numero: "2", puesto: 4 },
]);
eq("espacios", parsearOrden("5 1 3 2"), parsearOrden("5, 1, 3, 2"));
eq("mezclado y con guiones", parsearOrden("5-1-3, 2"), parsearOrden("5, 1, 3, 2"));
eq("sin espacios", parsearOrden("5,1,3"), parsearOrden("5, 1, 3"));
eq("guiones y barras", parsearOrden("5/1/3"), parsearOrden("5, 1, 3"));
eq("el primero es puesto 1, no el ultimo", parsearOrden("7, 2")[0], { numero: "7", puesto: 1 });
eq("descarta vacios", parsearOrden("5, , 1"), parsearOrden("5, 1"));
eq("descarta sobrerrepeticion", parsearOrden("5, 1, 5"), parsearOrden("5, 1"));
eq("texto vacio", parsearOrden(""), []);
eq("nulo", parsearOrden(null), []);
eq("solo comas", parsearOrden(" , , "), []);
{
  // Debe seguir siendo la entrada valida de la RPC: puestos enteros correlativos.
  const o = parsearOrden("5, 1, 3, 2, 4");
  eq("puestos correlativos", o.map((x) => x.puesto), [1, 2, 3, 4, 5]);
  eq("sin puestos repetidos", new Set(o.map((x) => x.puesto)).size, 5);
  eq("sin numeros repetidos", new Set(o.map((x) => x.numero)).size, 5);
}
{
  // El 14 es un caballo distinto del 1: la normalizacion no debe truncar.
  eq("el 14 no se vuelve 1", parsearOrden("14, 1")[0], { numero: "14", puesto: 1 });
}
{
  // Lo que sale de parsearOrden alimenta simularMarca tal cual.
  const r = simularMarca("1", ["2", "3"], parsearOrden("2, 1, 3"));
  eq("encadena con la simulacion", r.gana, false);
}

// ---------------------------------------------------------------------------
console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
