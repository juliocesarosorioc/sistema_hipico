// Pruebas de la VALIDACION DEL CABALLO al cargar una jugada.
//
// La regla: en la columna CABALLO no se puede escribir un numero que no corra.
//   - con caballos registrados, solo valen esos numeros;
//   - sin caballos registrados, se admite hasta el 16;
//   - salvo que la carrera cargada muestre mas de 16: ahi manda el maximo.
//
// Modulo PURO a proposito (`taquilla/caballos.ts` no importa Supabase ni React),
// asi que node lo corre directo; el runner lo compila antes.
import {
  TOPE_SIN_REGISTRO,
  maximoDeLaCarrera,
  numerosDeLaCarrera,
  numerosEscritos,
  revisarCaballo,
  revisarColumnaCaballo,
  topesPermitidos,
} from "../src/lib/taquilla/caballos";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

function ok(nombre: string, condicion: boolean) {
  eq(nombre, condicion, true);
}

const c = (...nums: (string | number)[]) => nums.map((numero) => ({ numero }));

// ---------------------------------------------------------------------------
console.log("\n[1] con caballos registrados SOLO valen esos numeros");
// ---------------------------------------------------------------------------
{
  const carrera = c(1, 2, 3, 7);
  ok("el 1 corre", revisarCaballo("1", carrera).ok);
  ok("el 7 corre (numero alto)", revisarCaballo("7", carrera).ok);
  const r = revisarCaballo("5", carrera);
  ok("el 5 NO corre", !r.ok);
  eq("reporta el invalido", r.invalidos, ["5"]);
  ok("el motivo dice que no corre", /no corre en esta carrera/.test(r.motivo ?? ""));
  ok("el motivo lista los participantes", /participan:/.test(r.motivo ?? ""));
}
{
  // El caso que da la lata: el operador tipea un numero bajo que no se largo.
  // "1" existe, "4" no. La revision es por conjunto, no por rango.
  const carrera = c(1, 5, 9);
  ok("1 y 9 valen", revisarCaballo("1", carrera).ok && revisarCaballo("9", carrera).ok);
  ok("2 NO vale aunque sea menor que el 5", !revisarCaballo("2", carrera).ok);
  ok("10 NO vale aunque el maximo sea 9", !revisarCaballo("10", carrera).ok);
}
{
  // La carrera muestra mas de 16 caballos: el 18 es un hecho, no se topa.
  const carrera = c(1, 2, 3, 12, 17, 18, 20);
  ok("el 18 corre", revisarCaballo("18", carrera).ok);
  ok("el 20 corre", revisarCaballo("20", carrera).ok);
  ok("el 19 no", !revisarCaballo("19", carrera).ok);
  eq("el tope NO se aplico (la carrera manda)", revisarCaballo("18", carrera).topeSinRegistro, false);
}

// ---------------------------------------------------------------------------
console.log("\n[2] SIN caballos registrados: hasta el 16");
// ---------------------------------------------------------------------------
{
  const vacia: { numero: string | number }[] = [];
  ok("sin lista, el 1 vale", revisarCaballo("1", vacia).ok);
  ok("sin lista, el 16 vale", revisarCaballo("16", vacia).ok);
  const r = revisarCaballo("17", vacia);
  ok("sin lista, el 17 NO vale", !r.ok);
  ok("el motivo dice el tope", /hasta el 16/.test(r.motivo ?? ""));
  eq("marco que uso el tope sin registro", r.topeSinRegistro, true);
  eq("el tope es 16", TOPE_SIN_REGISTRO, 16);
  eq("el rango son 16 numeros", topesPermitidos(vacia).size, 16);
}
{
  // La carrera cargada muestra mas de 16 SIN lista de registrados: el tope
  // sube al numero mas alto que la carrera muestra, no se queda en 16.
  const r = revisarCaballo("18", [], 18);
  ok("con maximoVisible 18, el 18 vale", r.ok);
  ok("y el 17 tambien", revisarCaballo("17", [], 18).ok);
  ok("pero el 19 no", !revisarCaballo("19", [], 18).ok);
}
{
  // maximoVisible mas chico que 16 NO baja el tope: 16 es el piso comodo.
  eq("maximoVisible chico no reduce el tope", topesPermitidos([], 8).size, 16);
  ok("y el 16 sigue valiendo", revisarCaballo("16", [], 8).ok);
  ok("el 9 tambien", revisarCaballo("9", [], 8).ok);
}

// ---------------------------------------------------------------------------
console.log("\n[3] el campo VACIO es una jugada sin ejemplar, no un error");
// ---------------------------------------------------------------------------
{
  const carrera = c(1, 2, 3);
  const r = revisarCaballo("", carrera);
  ok("vacio pasa", r.ok);
  eq("y se marca como vacio", r.vacio, true);
  eq("sin invalidos", r.invalidos, []);
  ok("sin motivo", !r.motivo);
  ok("undefined tambien pasa", revisarCaballo(undefined, carrera).ok);
  ok("espacios tambien", revisarCaballo("   ", carrera).ok);
  // Una jugada de Taquilla / 2n / triples no lleva ejemplar: no se bloquea.
  ok("'PP' no es un numero, no se revisa", revisarCaballo("PP", carrera).ok);
}

// ---------------------------------------------------------------------------
console.log("\n[4] la notacion que la columna ya admitia");
// ---------------------------------------------------------------------------
eq("'1'", numerosEscritos("1"), ["1"]);
eq("'1,2'", numerosEscritos("1,2"), ["1", "2"]);
eq("'1,2x3'", numerosEscritos("1,2x3"), ["1", "2", "3"]);
eq("'1-2'", numerosEscritos("1-2"), ["1", "2"]);
eq("' 3 ' con espacios", numerosEscritos(" 3 "), ["3"]);
eq("'01' -> '1'", numerosEscritos("01"), ["1"]);
eq("'' -> []", numerosEscritos(""), []);
eq("'PP' -> []", numerosEscritos("PP"), []);
{
  // Una expresion con un numero malo se rechaza ENTERA: si "1,2x3" tiene el 3
  // malo, la jugada entera no entra. Aceptar el 1 y el 2 seria vender medio
  //时间为 un caballo que no corre.
  const carrera = c(1, 2, 3, 4);
  ok("1,2x3 completa vale", revisarCaballo("1,2x3", carrera).ok);
  const r = revisarCaballo("1,2x9", carrera);
  ok("1,2x9 no vale", !r.ok);
  eq("reporta el 9", r.invalidos, ["9"]);
  ok("NO reporta los validos como invalidos", !r.invalidos.includes("1"));
}
{
  // "Todos" / "V" (caballo sin numero en la nomenclatura) no es un numero:
  // la columna CABALLO es de ejemplares numericos.
  const carrera = c(1, 2);
  ok("'V' no se toma como numero", revisarCaballo("V", carrera).ok);
}

// ---------------------------------------------------------------------------
console.log("\n[5] RETIRADOS: la lista manda, el retiro se avisa aparte");
// ---------------------------------------------------------------------------
{
  // El modulo NO bloquea al retirado (eso es decision de la apuesta, no un
  // numero inexistente) y NO lo deja pasar por invisible: si esta retirado,
  // sigue en `permitidos` y el operador lo ve en la lista de participantes.
  const carrera = [{ numero: 1 }, { numero: 8, retirado: true }];
  const r = revisarCaballo("8", carrera);
  ok("el retirado es un numero legitimo", r.ok);
  eq("y esta en la lista", r.permitidos.includes("8"), true);
}

// ---------------------------------------------------------------------------
console.log("\n[6] la lista de participantes se lee una vez, bien");
// ---------------------------------------------------------------------------
{
  const carrera = [
    { numero: " 3 " },
    { numero: 4 },
    { numero: null },
    { numero: "" },
    {},
  ];
  eq("descarta vacios y nulos", numerosDeLaCarrera(carrera), ["3", "4"]);
  eq("el maximo ignora los no numericos", maximoDeLaCarrera(carrera), 4);
  eq("maximo de carrera vacia", maximoDeLaCarrera([]), 0);
  eq("maximo con null", maximoDeLaCarrera(null), 0);
  eq("'20' como texto cuenta", maximoDeLaCarrera([{ numero: "20" }, { numero: "3" }]), 20);
}

// ---------------------------------------------------------------------------
console.log("\n[7] la carga completa se revisa de una vez");
// ---------------------------------------------------------------------------
{
  // El operador pega 6 lineas y solo una tiene el caballo malo: se le dice
  // WHICH linea, no se pierde la carga entera.
  const carrera = c(1, 2, 3);
  const malos = revisarColumnaCaballo(["1", "", "2", "9", "3", "1,2x7"], carrera);
  eq("dos filas malas", [...malos.keys()], [3, 5]);
  ok("la 3 es el 9", malos.get(3)?.invalidos.join() === "9");
  ok("la 5 es el 7", malos.get(5)?.invalidos.join() === "7");
  eq("las buenas no aparecen", malos.size, 2);
}
{
  eq("sin malos, mapa vacio", revisarColumnaCaballo(["1", "2"], c(1, 2)).size, 0);
  eq("carrera sin registrados: 17 es el unico malo", revisarColumnaCaballo(["17"], []).size, 1);
}

// ---------------------------------------------------------------------------
console.log("\n[8] GestionJugadasModule USA el modulo (no reimplementa la regla)");
// ---------------------------------------------------------------------------
{
  // El componente importa Supabase al cargarse, asi que se lee como texto.
  // Se resuelve desde `process.cwd()` y NO desde `__dirname`: el runner compila
  // este archivo a `%TEMP%\marcas-testbuild\pruebas\`, fuera del repo.
  const src = readFileSync(join(process.cwd(), "src", "components", "gestion", "GestionJugadasModule.tsx"), "utf8");
  // Si el componente vuelve a calcular el tope por su cuenta, la regla deja de
  // ser una sola y el navegador acepta un caballo que el servidor no.
  ok("importa revisarCaballo", /from "@\/lib\/taquilla\/caballos"/.test(src));
  ok("lo invoca en revisionCaballo", /revisionCaballo[\s\S]{0,120}revisarCaballo\(/.test(src));
  ok("cargarAtaquilla bloquea la fila", /cargarAtaquilla[\s\S]{0,1400}if \(!rc\.ok\)/.test(src));
  ok("NO reimplementa el tope con un 16 a mano", !/>\s*16\s*<\s*=/.test(src));
}

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
