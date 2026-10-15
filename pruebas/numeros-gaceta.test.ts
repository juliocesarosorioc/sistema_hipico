// ============================================================================
// NÚMEROS DE CARRERA DE LA GACETA — la defensa contra el incidente de la 13.ª.
//
// Fija el contrato de `@/features/gaceta/lib/numeros`:
//
//   A. `numeroDeCarrera` lee el número venga como venga (13, "13ª", "XIII",
//      "decimotercera", "CARRERA 13") y SIEMPRE devuelve el mismo entero.
//   B. La fusión NO pierde carreras distintas: si dos carreras traen el mismo
//      número pero ejemplares disjuntos, se conservan ambas.
//   C. `repararNumerosCarreras` renumera la carrera mal leída al número que
//      sigue (la 13.ª escrita como 10.ª → vuelve a ser 13) y UNE solo lo que de
//      verdad es la misma carrera partida entre páginas.
//
// El caso [1..12, 10] tiene su propio bloque porque es el que produjo el
// incidente: la sección "Carreras extraídas" mostraba 12 de 13.
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/numeros-gaceta.test.ts)
// ============================================================================
import {
  carrerasFaltantes,
  fusionarCarrerasSinPerder,
  mismaCarreraExtraida,
  numeroDeCarrera,
  repararNumerosCarreras,
  type CarreraMinima,
} from "@/features/gaceta/lib/numeros";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

const carrera = (n: number | string, nombres: string[]): CarreraMinima => ({
  carrera: n,
  hipodromo: "LA RINCONADA",
  ejemplares: nombres.map((nombre, i) => ({ numero: i + 1, nombre })),
});
const numeros = (arr: CarreraMinima[]) => arr.map((c) => c.carrera).sort((a, b) => Number(a) - Number(b));

// ----------------------------------------------------------------------------
console.log("\n== numeroDeCarrera: todas las formas → el mismo entero ==");
// ----------------------------------------------------------------------------
igual(numeroDeCarrera(13), 13, "13 (número)");
igual(numeroDeCarrera("13"), 13, "\"13\"");
igual(numeroDeCarrera("13ª"), 13, "\"13ª\"");
igual(numeroDeCarrera("XIII"), 13, "\"XIII\" (romano)");
igual(numeroDeCarrera("(VII)"), 7, "\"(VII)\" (romano entre paréntesis)");
igual(numeroDeCarrera("decimotercera"), 13, "\"decimotercera\" (ordinal)");
igual(numeroDeCarrera("DECIMOTERCERA carrera"), 13, "ordinal en mayúsculas");
igual(numeroDeCarrera("undécima"), 11, "ordinal con tilde");
igual(numeroDeCarrera("CARRERA 13"), 13, "\"CARRERA 13\"");
igual(numeroDeCarrera(0), null, "0 → null");
igual(numeroDeCarrera(""), null, "vacío → null");

// ----------------------------------------------------------------------------
console.log("\n== El caso que perdió la 13.ª carrera (se leyó como 10.ª) ==");
// ----------------------------------------------------------------------------
{
  const acc: CarreraMinima[] = [];
  for (let i = 1; i <= 12; i++) acc.push(carrera(i, [`C${i}A`, `C${i}B`]));
  // Segundo lote: la 13.ª salió numerada 10 con SUS caballos (disjuntos de la 10 real).
  fusionarCarrerasSinPerder(acc, [carrera(10, ["C13A", "C13B"])]);
  igual(acc.length, 13, "la fusión conserva las 13 entradas (no pierde la 13)");

  const rep = repararNumerosCarreras(acc);
  igual(acc.length, 13, "siguen 13 tras reparar");
  igual(numeros(acc), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "numeración 1..13 completa");
  igual(rep.renumeradas, [{ hipodromo: "LA RINCONADA", de: 10, a: 13 }], "renumeró 10→13");
  const trece = acc.find((c) => c.carrera === 13);
  igual(trece?.ejemplares?.map((e) => e.nombre), ["C13A", "C13B"], "la 13.ª conserva sus caballos");
}

// ----------------------------------------------------------------------------
console.log("\n== Misma carrera repetida entre páginas (comparte caballos) → se une ==");
// ----------------------------------------------------------------------------
{
  const acc: CarreraMinima[] = [];
  fusionarCarrerasSinPerder(acc, [carrera(5, ["A", "B"])]);
  fusionarCarrerasSinPerder(acc, [carrera(5, ["A", "B", "C"])]);
  igual(acc.length, 1, "una sola carrera");
  igual(acc[0].ejemplares?.length, 3, "une los ejemplares sin duplicar");
}

// ----------------------------------------------------------------------------
console.log("\n== Continuación partida entre páginas (puestos complementarios) → se une ==");
// ----------------------------------------------------------------------------
{
  const acc: CarreraMinima[] = [];
  for (let i = 1; i <= 6; i++) acc.push(carrera(i, [`R${i}A`]));
  acc.push({ carrera: 5, hipodromo: "LA RINCONADA", ejemplares: [{ numero: 7, nombre: "R5B" }] });
  const rep = repararNumerosCarreras(acc);
  igual(acc.length, 6, "no crea una carrera fantasma");
  igual(numeros(acc), [1, 2, 3, 4, 5, 6], "queda 1..6");
  igual(rep.renumeradas.length, 0, "no renumera");
  igual(rep.consolidadas, 1, "consolida la continuación");
}

// ----------------------------------------------------------------------------
console.log("\n== Secuencia con hueco interno: no se renumera, se informa ==");
// ----------------------------------------------------------------------------
{
  const acc = [carrera(1, ["A"]), carrera(3, ["C"])];
  const rep = repararNumerosCarreras(acc);
  igual(numeros(acc), [1, 3], "no toca una secuencia con hueco");
  igual(rep.sinResolver, 1, "informa el hueco (falta la 2)");
  igual(carrerasFaltantes([carrera(1, ["a"]), carrera(3, ["c"]), carrera(5, ["e"])]), [
    { hipodromo: "LA RINCONADA", faltan: [2, 4] },
  ], "carrerasFaltantes detecta 2 y 4");
}

// ----------------------------------------------------------------------------
console.log("\n== mismaCarreraExtraida ==");
// ----------------------------------------------------------------------------
igual(mismaCarreraExtraida(carrera(1, ["X"]), carrera(1, ["X", "Y"])), true, "comparte → misma");
igual(mismaCarreraExtraida(carrera(1, ["X"]), carrera(1, ["Z"])), false, "disjuntos → distintas");
igual(mismaCarreraExtraida(carrera(1, []), carrera(1, ["Z"])), true, "sin nombres → no distinguible");

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
