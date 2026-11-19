// Regresión: la extracción de carreras debe separar el nombre del ejemplar
// del resto de la fila (dorsal, ML, jinete, peso, entrenador, campana, S/C).
import {
  parsearFilaEjemplarRetrospecto,
  separarDatosEjemplar,
} from "../src/features/gaceta/lib/segmentar";

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

console.log("\n[1] fila con un solo espacio y código de pedigrí pegado");
const a = separarDatosEjemplar("5 5-1 CC3a- This Is The Life R. Saez 54,4 J. Smith");
eq("nombre", a.nombre, "THIS IS THE LIFE");
eq("dorsal", a.numero, "5");
eq("ml", a.ml, "5-1");
eq("jinete", a.jinete, "R. SAEZ");
eq("peso", a.pesoKg, 54.4);
eq("entrenador", a.entrenador, "J. SMITH");
eq("segmentado", a.segmentado, true);

console.log("\n[2] fila americana con sufijo Jr. y peso en libras");
const b = separarDatosEjemplar("1 Flightline I. Ortiz, Jr. 122 B. Baffert 3-1");
eq("nombre", b.nombre, "FLIGHTLINE");
eq("jinete", b.jinete, "I. ORTIZ, JR.");
eq("peso", b.pesoKg, 122);
eq("entrenador", b.entrenador, "B. BAFFERT");
eq("ml", b.ml, "3-1");

console.log("\n[3] jinete con iniciales sin punto");
const c = separarDatosEjemplar("3 WHITE ABARRIO J L ORTIZ 56 KG T. PLETCHER 8-1");
eq("nombre", c.nombre, "WHITE ABARRIO");
eq("jinete", c.jinete, "J L ORTIZ");
eq("peso", c.pesoKg, 56);
eq("entrenador", c.entrenador, "T. PLETCHER");

console.log("\n[4] nacionalidad y campana / días sin correr");
const d = separarDatosEjemplar("4 GRAN SOL (VEN) 54,5 L. Saez 0d S/C Act: (C. Diaz) $12.345,60 9-5");
eq("nombre", d.nombre, "GRAN SOL");
eq("dias", d.diasSinCorrer, 0);
eq("campana", d.campana, "Act: (C. Diaz) $12.345,60");
eq("ml", d.ml, "9-5");

console.log("\n[5] parser de fila visual usa el separador");
const fila = parsearFilaEjemplarRetrospecto("7 7-2 YZ4a- Catire Pedro J. Rosario 55,5 R. Diodoro 4-1");
eq("nombre fila", fila?.nombre, "CATIRE PEDRO");
eq("jinete fila", fila?.jinete, "J. ROSARIO");
eq("entrenador fila", fila?.entrenador, "R. DIODORO");
eq("peso fila", fila?.pesoKg, 55.5);
eq("ml fila", fila?.ml, "4-1");

console.log("\n[6] nombre limpio no se segmenta de más");
const limpio = separarDatosEjemplar("AMERICAN EXAMPLE");
eq("nombre limpio", limpio.nombre, "AMERICAN EXAMPLE");
eq("sin jinete", limpio.jinete, undefined);
eq("sin segmentar", limpio.segmentado, false);

console.log(`\nRESUMEN: ${pasan} pasan, ${fallan} fallan`);
if (fallan > 0) process.exitCode = 1;
