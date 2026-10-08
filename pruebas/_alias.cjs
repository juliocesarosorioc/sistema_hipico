// Resuelve el alias `@/…` (tsconfig "paths") al correr los .test.js emitidos
// por `tsc -p pruebas/tsconfig.json`: tsc no reescribe los alias en el JS y node
// no los conoce, así que `require("@/lib/supabase")` explotaba con
// MODULE_NOT_FOUND. Apunta al JS emitido (.tsbuild-pruebas/src), no al .ts.
//
// Uso: node -r ./pruebas/_alias.cjs .tsbuild-pruebas/pruebas/x.test.js
const path = require("path");
const fs = require("fs");
const Module = require("module");

const RAIZ = path.join(__dirname, "..");
const EMITIDO = path.join(RAIZ, ".tsbuild-pruebas", "src");
const orig = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
  if (typeof request === "string" && request.startsWith("@/")) {
    // Sin extensión: node prueba .js/.json/.cjs sobre esta base. Todo lo
    // alcanzable desde las pruebas ya está emitido (tsc compila sus deps).
    request = path.join(EMITIDO, request.slice(2));
  }
  return orig.call(this, request, ...args);
};
