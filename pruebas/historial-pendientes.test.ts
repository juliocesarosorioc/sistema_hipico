// ============================================================================
// ÍTEM 4 — HISTORIAL (antes BOLETO): vista operativa de TODO lo pendiente.
//
// El dueño quiere que la sección (antes BOLETO, ahora HISTORIAL) muestre todo lo
// que está pendiente de la plataforma: las carreras CON JUGADAS que todavía no
// tienen resultado, además de las ya liquidadas, con acceso directo al reporte.
//
// La fuente de los pendientes es la misma vista del Monitor de Jugadas
// (`v_jugadas_monitor`), para no crear una segunda verdad.
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
const src = readFileSync(join(raiz, "src", "features", "gestion", "components", "HistorialReporte.tsx"), "utf8");

console.log("\n[1] El inbox sale de la fuente del Monitor de Jugadas");
ok("importa listarMonitorJugadas", /import\s*\{\s*listarMonitorJugadas/.test(src));
ok("llama a listarMonitorJugadas", /await listarMonitorJugadas\(\)/.test(src));
ok("guarda los pendientes en estado", /const \[pendientes, setPendientes\] = useState<FilaMonitorJugada\[\]>/.test(src));

console.log("\n[2] Un pendiente = con jugadas y SIN resultado");
ok("filtra por la fecha de la jornada", /fila\.fecha_carrera === f/.test(src));
ok("exige que tenga jugadas", /fila\.total_jugadas > 0/.test(src));
ok("exige que NO tenga resultado", /!fila\.resultado_cargado/.test(src));

console.log("\n[3] Se muestra como sección operativa del HISTORIAL");
ok("rotula «Pendientes de resultado»", src.includes("Pendientes de resultado"));
ok("lista los pendientes (pendientesVisibles)", /pendientesVisibles\.map\(/.test(src));
ok("respeta el filtro de hipódromo", /const pendientesVisibles = useMemo\(/.test(src));
ok("ofrece el Reporte por pendiente", /setReporte\(\{\s*hipodromo:\s*normHip\(p\.hipodromo\),\s*carrera:\s*p\.carrera\s*\}\)/.test(src));
ok("el filtro de hipódromos también incluye pendientes", /for \(const p of pendientes\)/.test(src));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
