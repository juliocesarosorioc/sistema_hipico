/**
 * Corre TODA la suite de pruebas con un solo comando:
 *
 *   node pruebas/correr.cjs
 *
 *  1) emite el JS de `pruebas/tsconfig.json` a `.tsbuild-pruebas/`
 *  2) ejecuta cada `*.test.js` con el resolver de alias `@/…` (`_alias.cjs`)
 *  3) suma los contadores de cada archivo y sale con 1 si algo falló
 *
 * Sin esto había que acordarse del tsc, del `-r` y de la lista de archivos:
 * tres tests (`puertas-login`, `semana-vigente`, `searchable-select`) quedaban
 * afuera del tsconfig y nunca se corrían.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const ALIAS = path.join(__dirname, "_alias.cjs");
const DIR = path.join(RAIZ, ".tsbuild-pruebas", "pruebas");

console.log("[1/2] emitindo el JS de las pruebas (tsc -p pruebas/tsconfig.json)…");
try {
  // tsc directo (sin npx/shell): mismo binario, sin warnings de child_process.
  execFileSync(process.execPath, [path.join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", "pruebas/tsconfig.json"], {
    cwd: RAIZ,
    stdio: "inherit",
  });
} catch {
  console.error("\nFALLA: no se pudo compilar el proyecto de pruebas.");
  process.exit(1);
}

const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.js")).sort();
console.log(`[2/2] corriendo ${archivos.length} archivos…\n`);

let fallasArchivos = 0;
let totalOk = 0;
let totalFall = 0;

for (const f of archivos) {
  let salida = "";
  let codigo = 0;
  try {
    salida = execFileSync(process.execPath, ["-r", ALIAS, path.join(DIR, f)], { encoding: "utf8" });
  } catch (e) {
    salida = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    codigo = typeof e.status === "number" ? e.status : 1;
  }
  const ultima = salida.trim().split(/\r?\n/).pop() ?? "";
  const m = ultima.match(/(\d+)\s+(?:pasaron|ok),\s*(\d+)\s+fall/);
  const ok = m ? Number(m[1]) : null;
  const fall = m ? Number(m[2]) : null;
  if (ok !== null) {
    totalOk += ok;
    totalFall += fall;
  }
  const marca = codigo === 0 ? "ok  " : "FALLA";
  console.log(`  ${marca} ${f.padEnd(34)} exit=${codigo} ${m ? `${ok} ok / ${fall} fallaron` : ultima}`);
  if (codigo !== 0) fallasArchivos++;
}

console.log(`\nTOTAL: ${totalOk} aserciones ok, ${totalFall} fallaron · ${archivos.length} archivos · ${fallasArchivos} con error de salida`);
if (fallasArchivos > 0 || totalFall > 0) process.exit(1);
console.log("SUITE OK");
