// ============================================================================
// Pruebas de la validacion de Marcas contra la CARRERA REGISTRADA.
// Espejo de revisarConfig() en src/lib/marcas/registradas.ts y de las
// validaciones que repite la RPC club_vender_marca.
// Usa el tipo canonico EjemplarCarreraCentral, el mismo que entrega
// listarCarrerasCentrales al modal del modulo hípico.
// ============================================================================
import type { EjemplarCarreraCentral } from "../src/lib/carreras/central";
import {
  revisarConfig,
  candidatosAMarca,
  buscarEjemplar,
  etiquetaCaballo,
  indicePorNumero,
} from "../src/lib/marcas/registradas";

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

// Como los deja listarCarrerasCentrales: el retiro ya viene resuelto contra la
// lista central de la carrera (retirado del ejemplar O de la lista).
const caballos: EjemplarCarreraCentral[] = [
  { numero: "1", nombre: "GOLDENLYNN", retirado: false },
  { numero: "2", nombre: "LEADING LADY", retirado: false },
  { numero: "3", nombre: "MISTY COAL", retirado: false },
  { numero: "4", nombre: "STEEL LINK", retirado: true },
  { numero: "5", nombre: "J J'S JOKER", retirado: false },
  { numero: "14", nombre: "14 DE ABRIL", retirado: false },
];

console.log("\n[1] indicePorNumero / buscarEjemplar / etiqueta");
// ---------------------------------------------------------------------------
eq("indice por numero", [...indicePorNumero(caballos).keys()], ["1", "2", "3", "4", "5", "14"]);
eq("busca el 3", buscarEjemplar(caballos, "3")?.nombre, "MISTY COAL");
eq("no busca el 9", buscarEjemplar(caballos, "9"), null);
eq("etiqueta con nombre", etiquetaCaballo(caballos[0]), "1 · GOLDENLYNN");
eq("etiqueta sin nombre", etiquetaCaballo({ numero: "7" }), "7");
eq("el retirado viene resuelto", buscarEjemplar(caballos, "4")?.retirado, true);

console.log("\n[2] revisarConfig: configuracion valida");
// ---------------------------------------------------------------------------
{
  // La carrera tiene 1,2,3,4,5 y 14. El 6 NO corre, asi que usarlo de NV seria
  // inventarse un rival: el 14 si es un caballo real.
  const r = revisarConfig(caballos, ["1", "2", "3"], ["14"]);
  eq("es valida", r.valida, true);
  eq("sin mensaje", r.mensaje, undefined);
}
{
  // 14 no es 1: el match por numero exacto tiene que distinguirlos.
  const r = revisarConfig(caballos, ["14", "1"], []);
  eq("el 14 es un ejemplar distinto del 1", r.valida, true);
}

console.log("\n[3] revisarConfig: rechaza lo que no corresponde");
// ---------------------------------------------------------------------------
{
  const r = revisarConfig(caballos, ["1", "9"], []);   // el 9 no corre
  eq("marca que no corre -> invalida", r.valida, false);
  eq("y la senala", r.marcasInvalidas, ["9"]);
  eq("el mensaje lo nombra", /no corren: 9/.test(r.mensaje ?? ""), true);
}
{
  const r = revisarConfig(caballos, ["1"], ["8"]);     // el 8 no corre
  eq("NV que no corre -> invalida", r.valida, false);
  eq("y lo senala", r.nvInvalidos, ["8"]);
}
{
  const r = revisarConfig(caballos, ["1", "1", "2"], []);  // repetida
  eq("marca repetida -> invalida", r.valida, false);
  eq("la detecta", r.marcasRepetidas, ["1"]);
}
{
  const r = revisarConfig(caballos, ["1", "2"], ["2"]);  // marca y NV a la vez
  eq("marca y NV a la vez -> invalida", r.valida, false);
  eq("la senala", r.marcadosYNoVale, ["2"]);
}
{
  const r = revisarConfig(caballos, ["1", "4"], []);  // el 4 esta retirado
  eq("marca retirada -> invalida", r.valida, false);
  eq("la senala", r.marcasRetiradas, ["4"]);
}
{
  const r = revisarConfig([], ["1", "2"], []);  // carrera sin participantes
  eq("carrera vacia -> invalida", r.valida, false);
  eq("lo dice", r.carreraVacia, true);
  eq("y avisa", /no tiene ejemplares registrados/.test(r.mensaje ?? ""), true);
}
{
  // La carrera registrada solo por numero (sin nombres) es valida: el modulo
  // hípico la genera con numerosEjemplares(n) y hay que poder apostar ahí.
  const soloNumeros: EjemplarCarreraCentral[] = [
    { numero: "1" }, { numero: "2" }, { numero: "3" },
  ];
  const r = revisarConfig(soloNumeros, ["1", "2"], ["3"]);
  eq("carrera solo por numero es valida", r.valida, true);
}

console.log("\n[4] candidatosAMarca: solo lo que aun se puede marcar");
// ---------------------------------------------------------------------------
{
  const c = candidatosAMarca(caballos, ["1", "2", "3"], []);
  eq("ofrece los no marcados", c.map((x) => x.numero), ["4", "5", "14"]);
}
{
  const c = candidatosAMarca(caballos, ["1"], ["5"]);
  eq("excluye los que ya son NV", c.map((x) => x.numero), ["2", "3", "4", "14"]);
}
{
  const c = candidatosAMarca(caballos, ["1", "2", "3", "4", "5", "14"], []);
  eq("si esta todo marcado, no queda nada", c.length, 0);
}

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
