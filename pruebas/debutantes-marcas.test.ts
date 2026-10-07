// ============================================================================
// Pruebas de la regla de DEBUTANTES.
//
// Espejo de lo que hace club_vender_marca en sql/marcas_venta.sql. Si estas
// pruebas pasan y el SQL no, el validador estatico no lo va a notar: por eso
// la E2E tambien cubre el debutante bloqueando una venta real.
//
// La regla es una sola: si el switch dice que los debutantes NO valen, el
// debutante se mete al NV. Todo lo demas (no jugable, no rival) sale de ahi.
// ============================================================================
import { calcularRivales, separarNumeros } from "../src/lib/marcas/jerarquia";
import { revisarConfig } from "../src/lib/marcas/registradas";
import type { EjemplarCarreraCentral } from "../src/lib/carreras/central";

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

function ok(nombre: string, cond: boolean, detalle = "") {
  if (cond) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? "\n         " + detalle : ""}`);
  }
}

// Caballos 1..5 de la carrera de prueba.
const caballos: EjemplarCarreraCentral[] = ["1", "2", "3", "4", "5"].map((n) => ({ numero: n }));

console.log("\n[1] El debutante NO vale: se comporta como un NV");
{
  // 5 es debutante y no vale. No se puede jugar, igual que un NV.
  const r = calcularRivales("5", "1/2/3", "", "5", false);
  ok("el debutante con el switch apagado queda bloqueado", r.valido === false, JSON.stringify(r));
  ok(
    "  y el mensaje dice 'debutante', no 'NV'",
    /debutante/i.test(r.mensaje ?? "") && !/es NV/i.test(r.mensaje ?? ""),
    `mensaje: ${r.mensaje}`
  );

  // Y el NV de verdad sigue bloqueado con su propio mensaje.
  const rnv = calcularRivales("4", "1/2/3", "4", "5", false);
  ok("un NV de verdad sigue bloqueado", rnv.valido === false);
  ok("  con el mensaje de NV", /es NV/i.test(rnv.mensaje ?? ""), `mensaje: ${rnv.mensaje}`);

  // No jugable = tampoco puede ser rival. Como un debutante no puede estar en
  // las marcas, el fold no lo puede colar como rival.
  const rival = calcularRivales("2", "1/2/5", "", "5", false);
  ok(
    "un debutante no aparece como rival aunque este en las marcas",
    rival.valido === true && !rival.candidatos?.includes("5"),
    JSON.stringify(rival)
  );
}

console.log("\n[2] El debutante SÍ vale: no cambia nada");
{
  // Mismo caso, switch en true. El debutante se juega como un caballo normal.
  const r = calcularRivales("5", "1/2/3", "", "5", true);
  ok("el debutante con el switch encendido se puede jugar", r.valido === true, JSON.stringify(r));
  eq("  tiene de candidatos las 3 marcas", r.candidatos, ["1", "2", "3"]);
  eq("  pero el match es contra una sola", r.rival, "1");

  // Un debutante que ademas esta en las marcas juega por su posicion, como
  // cualquier caballo.
  const enMarcas = calcularRivales("5", "1/2/5", "", "5", true);
  eq("un debutante en las marcas juega contra su izquierda", enMarcas.candidatos, ["1", "2"]);
}

console.log("\n[3] Compatibilidad hacia atras (parametros opcionales)");
{
  // Los llamadores viejos pasan 3 argumentos: no se rompen.
  const r = calcularRivales("5", "1/2/3", "");
  ok("sin debutantes sigue funcionando", r.valido === true && r.rival === "1", JSON.stringify(r));
  const rnv = calcularRivales("3", "1/2/3", "3");
  ok("sin debutantes sigue bloqueando el NV", rnv.valido === false);
  const rev = revisarConfig(caballos, ["1", "2"], []);
  ok("revisarConfig sin debutantes sigue funcionando", rev.valida === true, rev.mensaje);
}

console.log("\n[4] El switch apagado no toca los NV reales");
{
  // 4 es NV, 5 es debutante, switch apagado. Ambos bloquean, y el NV no
  // desaparece de la lista por el fold.
  const r = calcularRivales("4", "1/2/3", "4", "5", false);
  ok("el NV real sigue bloqueado con el debutante tambien bloqueado", r.valido === false);
  ok("  y el mensaje es el de NV", /es NV/i.test(r.mensaje ?? ""), `mensaje: ${r.mensaje}`);
}

console.log("\n[5] revisarConfig valida la columna de debutantes");
{
  // Un debutante que no corre: error siempre, tenga el switch en true o false.
  const mal = revisarConfig(caballos, ["1", "2"], [], ["9"]);
  ok("un debutante que no corre invalida la configuracion", mal.valida === false);
  ok("  y lo dice en el mensaje", /debutantes que no corren: 9/.test(mal.mensaje ?? ""), mal.mensaje);

  // Marca y debutante a la vez es contradictorio.
  const ambos = revisarConfig(caballos, ["1", "5"], [], ["5"]);
  ok("marca y debutante a la vez invalida", ambos.valida === false);
  ok("  y lo dice en el mensaje", /marca y debutante: 5/.test(ambos.mensaje ?? ""), ambos.mensaje);

  // Configuracion buena con debutantes.
  const buena = revisarConfig(caballos, ["1", "2"], ["3"], ["5"]);
  ok("una configuracion valida con debutantes pasa", buena.valida === true, buena.mensaje);
  eq("  y no reporta debutantes invalidos", buena.debutantesInvalidos, []);
  eq("  ni marcados y debutante", buena.marcadosYDebutante, []);
}

console.log("\n[6] El separador es /");
{
  eq("separarNumeros parte por barra", separarNumeros("1/4/7"), ["1", "4", "7"]);
  eq("ignora espacios", separarNumeros(" 1 / 4 / 7 "), ["1", "4", "7"]);
  eq("descarta segmentos vacios", separarNumeros("1//4/"), ["1", "4"]);
  eq("cadena vacia", separarNumeros(""), []);
  eq("undefined", separarNumeros(undefined), []);
  // El fold tiene que sobrevivir a una lista de debutantes con huecos.
  const r = calcularRivales("4", "1/2/3", "", "4//5/6", false);
  ok("el fold aguanta una lista de debutantes con huecos", r.valido === false && /debutante/i.test(r.mensaje ?? ""), JSON.stringify(r));
}

console.log(`\nTODO OK: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan) {
  console.log("");
  process.exit(1);
}
console.log("");
