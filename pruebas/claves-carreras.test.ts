// ============================================================================
// Pruebas de la clave compartida de hipódromo/carrera y del agrupador del
// registro central (src/lib/carreras/claves.ts).
//
// El bug que estas pruebas cubren: cada módulo normalizaba el nombre de
// hipódromo a su manera (trim+uppercase aquí, sin quitar espacios allá). Basta
// con que una fila viniera "LA urel" y una normalización produjera "LAUREL" y
// otra "LA UREL": la misma carrera se veía en unos módulos y en otros no.
// ============================================================================
import {
  claveHipodromo,
  numeroCarrera,
  claveCarrera,
  agruparCarreras,
  numerosDeCarrera,
} from "../src/lib/carreras/claves";

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

console.log("\n[1] claveHipodromo: una sola clave para todos los módulos");
// ---------------------------------------------------------------------------
eq("ya en mayusculas", claveHipodromo("LAUREL"), "LAUREL");
eq("pasa a mayusculas", claveHipodromo("laurel"), "LAUREL");
eq("quita espacios de los bordes", claveHipodromo("  LAUREL  "), "LAUREL");
// El caso que rompía el cruce: un espacio interno.
eq("quita espacios internos", claveHipodromo("LA urel"), "LAUREL");
eq("colapsa espacios multiples", claveHipodromo("LA   U   REL"), "LAUREL");
eq("tolera tabulador", claveHipodromo("LA\tUREL"), "LAUREL");
// Sin hipodromo no hay clave: no debe inventar una fila vacía.
eq("vacio", claveHipodromo(""), "");
eq("solo espacios", claveHipodromo("   "), "");
eq("null", claveHipodromo(null), "");
eq("undefined", claveHipodromo(undefined), "");
eq("no string", claveHipodromo(42), "42");

console.log("\n[2] claveHipodromo:hipodromos con y sin espacios colisionan");
// ---------------------------------------------------------------------------
{
  // El criterio: si dos escrituras del mismo hipódromo producen la MISMA clave,
  // el cruce funciona; si producen claves distintas, la carrera se parte en dos.
  const filaA = claveHipodromo("Laurel");
  const filaB = claveHipodromo(" LAUREL");
  const filaC = claveHipodromo("LA urel");
  eq("las tres formas coinciden", [filaA, filaB, filaC], ["LAUREL", "LAUREL", "LAUREL"]);
}

console.log("\n[3] numeroCarrera: lo que no es numero vale 0");
// ---------------------------------------------------------------------------
eq("numero", numeroCarrera(5), 5);
eq("string numerico", numeroCarrera("5"), 5);
eq("con espacios", numeroCarrera(" 5 "), 5);
eq("decimal trunca", numeroCarrera("5.9"), 5);
eq("cero", numeroCarrera(0), 0);
eq("negativo", numeroCarrera(-3), 0);
eq("PP", numeroCarrera("PP"), 0);
eq("vacio", numeroCarrera(""), 0);
eq("V", numeroCarrera("V"), 0);
eq("basura", numeroCarrera("abc"), 0);
eq("null", numeroCarrera(null), 0);
eq("undefined", numeroCarrera(undefined), 0);
// El numero de carrera es un entero: un "3B" no puede colarse como carrera 3.
eq("no colarse '3B'", numeroCarrera("3B"), 0);

console.log("\n[4] claveCarrera: hipodromo + carrera + fecha");
// ---------------------------------------------------------------------------
eq("con fecha", claveCarrera("LA urel", "3", "2026-10-04"), "LAUREL|3|2026-10-04");
eq("sin fecha", claveCarrera("laurel", 3), "LAUREL|3");
eq("recorta la fecha", claveCarrera("LAUREL", 3, "2026-10-04T00:00:00Z"), "LAUREL|3|2026-10-04");

console.log("\n[5] agruparCarreras: agrupa, ordena y descarta");
// ---------------------------------------------------------------------------
{
  const carreras = [
    { hipodromo: "LAUREL", carrera: 3 },
    { hipodromo: "laurel", carrera: 1 },
    { hipodromo: "LA UREL", carrera: 2 },
    { hipodromo: "GAMER", carrera: 1 },
    { hipodromo: "", carrera: 1 },          // sin hipodromo: fuera
    { hipodromo: "LAUREL", carrera: "PP" }, // no es carrera: fuera
    { hipodromo: "LAUREL", carrera: null }, // tampoco: fuera
  ];
  const mapa = agruparCarreras(carreras);
  eq("los tres nombres son el mismo hipodromo", [...mapa.keys()], ["LAUREL", "GAMER"]);
  // `agruparCarreras` ordena pero NO reescribe el valor: conserva el tipo que
  // trae la fila (aqui "2" sigue siendo string).
  eq("las carreras quedan ordenadas", mapa.get("LAUREL")?.map((c) => c.carrera), [1, 2, 3]);
  eq("y el otro hipodromo no se mezclo", mapa.get("GAMER")?.length, 1);
}
{
  eq("lista vacia", agruparCarreras([]).size, 0);
}
{
  // Ordena tambien cuando el numero viene como texto: "10" debe quedar tras
  // el 2, no antes (comparar strings daria "10" < "2").
  const mapa = agruparCarreras([
    { hipodromo: "X", carrera: "10" },
    { hipodromo: "X", carrera: "2" },
  ]);
  eq("orden numerico, no lexicografico", mapa.get("X")?.map((c) => c.carrera), ["2", "10"]);
}
{
  // Sin hipodromo ni carrera no se crea ninguna entrada: un grupo vacío se
  // vería como un hipódromo fantasma en el Monitor.
  const mapa = agruparCarreras([{ hipodromo: "", carrera: 1 }, { hipodromo: "X", carrera: 0 }]);
  eq("nada de grupos fantasma", [...mapa.keys()], []);
}

console.log("\n[6] numerosDeCarrera: numeros unicos y ordenados");
// ---------------------------------------------------------------------------
{
  const carreras = [
    { hipodromo: "LAUREL", carrera: 10 },
    { hipodromo: "LAUREL", carrera: 2 },
    { hipodromo: "LAUREL", carrera: 2 },   // repetida
    { hipodromo: "GAMER", carrera: 5 },
  ];
  eq("sin repetir y ordenado", numerosDeCarrera(carreras, "laurel"), [2, 10]);
  // La clave normalizada es lo que hace que "laurel" encuentre a "LA UREL".
  eq("encuentra con el nombre en otro formato", numerosDeCarrera(carreras, " LA urel "), [2, 10]);
  eq("otro hipodromo", numerosDeCarrera(carreras, "GAMER"), [5]);
  eq("hipodromo inexistente", numerosDeCarrera(carreras, "NOSE"), []);
  eq("sin hipodromo", numerosDeCarrera(carreras, null), []);
}

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
