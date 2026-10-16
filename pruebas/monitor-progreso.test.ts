// ============================================================================
// ÍTEM 3 — Monitor de Jugadas: tablero de PROGRESO DE RESULTADOS por carrera.
//
// El dueño pide un tablero por jornada (Programadas · con resultado ·
// liquidadas), por hipódromo y con el total del día, enganchado a la MISMA
// fuente que el semáforo (matriz `carreras` + `resultados_carreras`), sin una
// segunda verdad.
//
// Antes el avance se calculaba solo con las carreras que TIENEN jugadas
// (`totales.conResultado / totales.carreras`), así que una carrera programada
// sin jugadas no contaba. Este test blinda el cambio.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

const raiz = process.cwd();
const src = readFileSync(join(raiz, "src", "features", "jugadas", "components", "JugadasModule.tsx"), "utf8");

console.log("\n[1] La fuente es la MISMA del semáforo (registro central)");
ok("importa useRegistroCentralOpts", /from\s*"@\/shared\/store\/useRegistroCentral"/.test(src));
ok("lee las carreras del registro central", /useRegistroCentralOpts\(fecha\)/.test(src));
ok("arranca en el día actual (hoyLocal)", /useState\(\(\) => hoyLocal\(\)\)/.test(src));

console.log("\n[2] Tablero por jornada: programadas · con resultado · liquidadas");
ok("define el tablero (jornada)", /const jornada = useMemo\(/.test(src));
ok("cuenta las programadas (total)", /total:\s*0,\s*conResultado:\s*0,\s*liquidadas:\s*0/.test(src));
ok("marca las que tienen resultado", /ganadores\?\.length\s*\?\?\s*0\)\s*>\s*0/.test(src));
ok("marca las liquidadas (estado/aplicado)", /est === "liquidada"/.test(src));
ok("agrupa por hipódromo", /filasHip/.test(src));
ok("rotula el progreso de la jornada", src.includes("Progreso de la jornada"));

console.log("\n[3] Se elimina la segunda verdad (solo carreras con jugadas)");
ok("ya no calcula `progreso = conResultado / carreras`", !/const progreso = totales\.carreras/.test(src));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
