// pruebas/validador-gaceta.test.ts
import assert from "node:assert";
import {
  validarCarrera,
  validarLoteCarreras,
  generarMensajeResumenImportacion,
  generarMensajeParaAgenteIA,
} from "../src/features/gaceta/lib/validador";

console.log("=== PRUEBAS DE VALIDADOR Y MENSAJERÍA DE GACETA IA ===");

// 1. Carrera completa
const cCompleta = {
  carrera: 1,
  hipodromo: "LA RINCONADA",
  fecha: "2026-10-30",
  distancia: 1200,
  superficie: "ARENA",
  premio: 100,
  archivoOrigen: "gaceta_r1-5.pdf",
  ejemplares: [
    { numero: 1, nombre: "HORSE ONE", jockey: "J. HERRERA", valor: 10 },
    { numero: 2, nombre: "HORSE TWO", jockey: "R. CAPRILES", valor: 15 },
    { numero: 3, nombre: "HORSE THREE", jockey: "F. QUEVEDO", valor: 20 },
  ],
};

const diag1 = validarCarrera(cCompleta);
assert.strictEqual(diag1.esCompleta, true, "La carrera completa debe ser completa");
assert.strictEqual(diag1.nivel, "completa");
assert.strictEqual(diag1.totalCaballos, 3);
assert.strictEqual(diag1.caballosFaltantes.length, 0);
console.log("✔ Carrera completa validada correctamente");

// 2. Carrera incompleta: omisión de caballo #3 en secuencia [1, 2, 4]
const cIncompleta = {
  carrera: 2,
  hipodromo: "LA RINCONADA",
  fecha: "2026-10-30",
  distancia: 0, // falta distancia
  superficie: "ARENA",
  premio: 100,
  archivoOrigen: "gaceta_r1-5.pdf",
  ejemplares: [
    { numero: 1, nombre: "HORSE ONE", jockey: "J. HERRERA" },
    { numero: 2, nombre: "HORSE TWO", jockey: "R. CAPRILES" },
    { numero: 4, nombre: "HORSE FOUR", jockey: "F. QUEVEDO" }, // falta el 3!
  ],
};

const diag2 = validarCarrera(cIncompleta);
assert.strictEqual(diag2.esCompleta, false, "Carrera con hueco no debe estar completa");
assert.deepStrictEqual(diag2.caballosFaltantes, [3], "Debe detectar que falta el caballo #3");
assert.strictEqual(diag2.tieneDistancia, false, "Debe detectar que distancia está en 0");
console.log("✔ Carrera incompleta con omisión de caballo #3 detectada con precisión");

// 3. Carrera con caballo sin nombre y duplicado
const cConErrores = {
  carrera: 3,
  hipodromo: "",
  distancia: 1400,
  archivoOrigen: "gaceta_r6-10.pdf",
  ejemplares: [
    { numero: 1, nombre: "SIN NOMBRE" },
    { numero: 1, nombre: "OTRO CABALLO" },
  ],
};

const diag3 = validarCarrera(cConErrores);
assert.strictEqual(diag3.nivel, "incompleta", "Debe ser nivel incompleta");
assert.strictEqual(diag3.caballosSinNombre.length, 1, "Debe detectar caballo sin nombre");
assert.strictEqual(diag3.numerosDuplicados.includes(1), true, "Debe detectar número duplicado 1");
console.log("✔ Errores graves (sin nombre y duplicados) detectados correctamente");

// 4. Validación de lote con múltiples archivos
const lote = [cCompleta, cIncompleta, cConErrores];
const reporte = validarLoteCarreras(lote, ["gaceta_r1-5.pdf", "gaceta_r6-10.pdf"]);

assert.strictEqual(reporte.totalArchivos, 2, "Debe haber 2 archivos");
assert.strictEqual(reporte.totalCarreras, 3, "Debe haber 3 carreras");
assert.strictEqual(reporte.totalCaballos, 3 + 3 + 2, "Total de caballos debe ser 8");
assert.strictEqual(reporte.carrerasCompletas, 1, "1 carrera completa");
assert.strictEqual(reporte.desglosePorArchivo.length, 2, "Desglose de 2 archivos");
console.log("✔ Reporte consolidado de lote y múltiples archivos generado correctamente");

// 5. Mensaje de mensajería para WhatsApp / Operadores
const msg = generarMensajeResumenImportacion(reporte, "2026-10-30", "LA RINCONADA");
assert.ok(msg.includes("Total Archivos:* 2"), "Mensaje debe contener total de archivos");
assert.ok(msg.includes("Total Carreras:* 3"), "Mensaje debe contener total de carreras");
assert.ok(msg.includes("gaceta_r1-5.pdf"), "Mensaje debe listar gaceta_r1-5.pdf");
assert.ok(msg.includes("gaceta_r6-10.pdf"), "Mensaje debe listar gaceta_r6-10.pdf");
console.log("✔ Mensaje para mensajería generado con el desglose exacto de archivos y caballos");

// 6. Mensaje de instrucción para Agente IA
const msgAgente = generarMensajeParaAgenteIA(cIncompleta, diag2, "2026-10-30");
assert.ok(msgAgente.includes("Carrera 2"), "Mensaje agente debe mencionar Carrera 2");
assert.ok(msgAgente.includes("#3"), "Mensaje agente debe mencionar que falta el ejemplar #3");
console.log("✔ Instrucción para el Agente IA generada correctamente con las discrepancias");

console.log("🎉 TODAS LAS PRUEBAS DEL VALIDADOR PASARON CON ÉXITO.");
