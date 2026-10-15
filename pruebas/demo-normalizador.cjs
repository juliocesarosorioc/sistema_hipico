// ============================================================================
// DEMO · Normalizador de Carga Rápida (Capa 1 local).
//
// Muestra un bloque de dictado REAL de un transcriptor (con errores de voz)
// y cómo queda ORDENADO en la carga individual: CL1 · CL2 · MONTO · JUGADA ·
// CABALLO. Es exactamente lo que ve la vista previa del modal ⚡ Carga Rápida.
//
// Uso (primero compilar el JS de las pruebas una vez):
//   node pruebas/correr.cjs                → emite .tsbuild-pruebas/ y corre la suite
//   node pruebas/demo-normalizador.cjs
//
// El runner no ejecuta este archivo (no termina en .test.js).
// ============================================================================
const { join } = require("path");

// normalizar.js importa "@/…" (alias de tsconfig); el respaldo que usan los
// tests resuelve ese alias hacia el JS emitido.
require(join(__dirname, "_alias.cjs"));

const { normalizarLineaRapida } = require(
  join(__dirname, "..", ".tsbuild-pruebas", "src", "lib", "taquilla", "normalizar.js")
);

// Catálogo de clientes y padrón del día (como los carga la app).
const CLIENTES = [
  { nombre: "Perrito Molinas" },
  { nombre: "Marlene" },
  { nombre: "Emy" },
  { nombre: "Mar" },
  { nombre: "Lolo" },
  { nombre: "Ana María" },
  { nombre: "Luis Suárez" },
  { nombre: "Carlos Pérez" },
  { nombre: "Juan Pedro" },
  { nombre: "Eddie Manuel" },
];
const CABALLOS = [
  { numero: 1, nombre: "Relámpago" },
  { numero: 2, nombre: "Furia" },
  { numero: 3, nombre: "Trueno" },
  { numero: 4, nombre: "Galán" },
  { numero: 5, nombre: "Estrella" },
  { numero: 7, nombre: "Centella" },
  { numero: 9, nombre: "Brisa" },
];

const BLOQUE = [
  "señores buenas juega perito molinas a la par con el cinco doscientos y da marlene",
  "2p 1 100 Perrito molinas",
  "Juega Lolo 2p (1) con 300 da Mar",
  "tres y tres el nueve cuarenta emy y mar",
  "señores siga la jugada dos p el cinco cien para ana maria y da perrito molinas",
  "un p con el galan noventa para luis suarez y da carlos perez",
  "diez a ocho el caballo numero cuatro doscientos marlene y emy",
  "dos n el siete quinientos para juan pedro y da eddie manuel",
  "señores que pasa con el tiempo hoy",
];

console.log("=".repeat(100));
console.log(" DEMO · Carga Rápida — dictado del transcriptor (con errores de voz) → carga individual");
console.log("=".repeat(100));

console.log(`\nDICTADO (${BLOQUE.length} líneas):`);
BLOQUE.forEach((l, i) => console.log(`  ${String(i + 1).padStart(2)}) ${l}`));

const R = (s = "", n) => String(s).padEnd(n).slice(0, n);
let okCount = 0;
console.log(`\nCARGA INDIVIDUAL ordenada:`);
console.log(`  ${R("#", 3)} ${R("CLIENTE 1", 17)}│ ${R("CLIENTE 2", 17)}│ ${R("MONTO", 8)}│ ${R("JUGADA", 8)}│ ${R("CABALLO", 8)}`);
console.log(`  ${"-".repeat(3)} ${"-".repeat(18)}┼ ${"-".repeat(18)}┼ ${"-".repeat(9)}┼ ${"-".repeat(9)}┼ ${"-".repeat(9)}`);
BLOQUE.forEach((linea, i) => {
  const r = normalizarLineaRapida(linea, { clientes: CLIENTES, caballos: CABALLOS });
  const n = String(i + 1).padEnd(3);
  if (r && r.ok) {
    okCount++;
    const fila = `  ${n} ${R(r.cliente1, 17)}│ ${R(r.cliente2 || "⚠ completar", 17)}│ ${R("$" + r.monto, 8)}│ ${R(r.jugada, 8)}│ ${R("N°" + r.caballo, 8)}`;
    console.log(fila + (r.confianza.cliente2 === "sin" ? "   ← fila roja: falta el DADOR" : ""));
  } else {
    console.log(`  ${n} 🔴 ILEGIBLE — queda como fila roja editable para completar a mano (no se descarta)`);
  }
});
console.log(`\n⚡ ${okCount} jugadas detectadas · ${BLOQUE.length - okCount} línea ininteligible → fila roja editable.`);