// ============================================================================
// ÍTEM 11 — HISTORIAL (antes BOLETO): lista de resultados cargados.
//
// El dueño pide que la sección —antes llamada BOLETO, ahora HISTORIAL— liste las
// carreras con resultado YA CARGADO, filtradas por hipódromo y (por defecto) el
// día actual, y que desde esa misma lista se elija la carrera para abrir su
// Reporte de Liquidación.
//
// No se puede ejercitar el render sin navegador, así que se blinda la capa de
// componente: que `HistorialReporte` arranque en el día de hoy, tenga el filtro
// por hipódromo, ofrezca el botón "🧾 Reporte" por carrera y abra el modal.
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
const src = readFileSync(
  join(raiz, "src", "features", "gestion", "components", "HistorialReporte.tsx"),
  "utf8"
);

console.log("\n[1] HISTORIAL parte del día actual y filtra por hipódromo");
ok("importa hoyLocal", /from\s*"@\/features\/gaceta\/lib\/programa"/.test(src));
ok("la fecha arranca en hoyLocal()", /useState<string>\(\(\)\s*=>\s*hoyLocal\(\)\)/.test(src));
ok("tiene el filtro por hipódromo (select)", /<select[\s\S]*?hipodromoFiltro[\s\S]*?setHipodromoFiltro/.test(src));
ok("calcula los hipódromos presentes", /const hipodromos = useMemo\(/.test(src));
ok("filtra las carreras por hipódromo", /const carrerasVisibles = useMemo\(/.test(src));
ok("renderiza la lista filtrada (carrerasVisibles.map)", /carrerasVisibles\.map\(/.test(src));
ok("ya NO renderiza la lista sin filtrar (carreras.map)", !/carreras\.map\(/.test(src));

console.log("\n[2] Desde la lista se elige la carrera y se abre el Reporte");
ok(
  "importa el Reporte de Liquidación",
  /import\s+ReporteLiquidacionModal\s+from\s*"@\/features\/gestion\/components\/ReporteLiquidacionModal"/.test(src)
);
ok("el botón por carrera abre el reporte", /setReporte\(\{\s*hipodromo:[\s\S]*?carrera:/.test(src));
ok("el botón se rotula \"🧾 Reporte\"", src.includes("🧾 Reporte"));
ok("renderiza el modal con las props del reporte", /<ReporteLiquidacionModal[\s\S]*?abierto=\{!!reporte\}[\s\S]*?onCerrar=/.test(src));
ok(
  "el modal recibe hipódromo y carrera elegidos",
  /hipodromoInicial=\{reporte\?\.hipodromo\}[\s\S]*?carreraInicial=\{reporte\?\.carrera\}/.test(src)
);
ok("la sección se rotula HISTORIAL", /<h1[^>]*>Historial<\/h1>/.test(src));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
