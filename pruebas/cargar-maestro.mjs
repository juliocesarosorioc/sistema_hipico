// ============================================================================
// Carga el REGISTRO MAESTRO de seguridad (TypeScript) para los validadores.
//
// No hay tsx/ts-node en el repo, así que se compila con el compilador que ya
// está instalado a un temporal y se importa desde ahí. Es determinista: no
// depende de regex sobre el fuente ni de que el registro "parezca" válido.
//
// Se usa desde maestro-seguridad.test.mjs y validar-rbac.mjs para que ambos
// Tribunales Miren exactamente el mismo registro.
// ============================================================================
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RAIZ = process.cwd();

/**
 * Compila `src/lib/seguridad/{capacidades,resolver}.ts` y devuelve sus
 * exportaciones combinadas. Lanza con un mensaje claro si tsc falla.
 */
const MODULOS = ["capacidades", "resolver", "vigente", "abac", "tipos"];

/**
 * El ABAC, por separado del registro de capacidades.
 *
 * Viene en su propia función porque `vigente.ts` importa a `abac.ts` y a
 * `capacidades.ts`; compilarlo todo junto funciona, pero cuando el generador
 * solo necesita las reglas (sin tocar el store) es más simple pedirlo aparte y
 * no arrastrar la sesión de navegador.
 */
export async function cargarAbac() {
  const tmp = mkdtempSync(join(tmpdir(), "abac-"));
  const tsconfig = join(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: join(tmp, "out"),
        module: "es2022",
        target: "es2022",
        moduleResolution: "bundler",
        baseUrl: RAIZ,
        paths: { "@/*": ["src/*"] },
        skipLibCheck: true,
        rootDir: RAIZ,
        lib: ["dom", "es2022"],
      },
      files: [
        join(RAIZ, "src/lib/seguridad/tipos.ts"),
        join(RAIZ, "src/lib/seguridad/capacidades.ts"),
        join(RAIZ, "src/lib/seguridad/abac.ts"),
      ],
    }),
    "utf8"
  );
  try {
    const tsc = join(RAIZ, "node_modules", "typescript", "bin", "tsc");
    try {
      execFileSync(process.execPath, [tsc, "-p", tsconfig], {
        cwd: RAIZ,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new Error(
        `tsc no pudo compilar el ABAC:\n${`${e.stdout ?? ""}${e.stderr ?? ""}`.trim()}`
      );
    }
    const out = join(tmp, "out", "src", "lib", "seguridad");
    for (const f of ["tipos.js", "capacidades.js", "abac.js"]) {
      const ruta = join(out, f);
      writeFileSync(
        ruta,
        readFileSync(ruta, "utf8").replace(/@\/lib\/seguridad\/(\w+)/g, "./$1.js"),
        "utf8"
      );
    }
    const salida = {};
    for (const m of ["tipos", "capacidades", "abac"]) {
      Object.assign(salida, await import(pathToFileURL(join(out, `${m}.js`)).href));
    }
    return salida;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function cargarRegistro() {
  const tmp = mkdtempSync(join(tmpdir(), "maestro-"));
  const tsconfig = join(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: join(tmp, "out"),
        module: "es2022",
        target: "es2022",
        moduleResolution: "bundler",
        baseUrl: RAIZ,
        paths: { "@/*": ["src/*"] },
        skipLibCheck: true,
        rootDir: RAIZ,
      },
      files: MODULOS.map((m) => join(RAIZ, `src/lib/seguridad/${m}.ts`)),
    }),
    "utf8"
  );
  try {
    // Se invoca el compilador LOCAL por su ruta real: en Windows, `npx.cmd`
    // vía spawnSync tira EINVAL.
    const tsc = join(RAIZ, "node_modules", "typescript", "bin", "tsc");
    try {
      execFileSync(process.execPath, [tsc, "-p", tsconfig], {
        cwd: RAIZ,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new Error(
        `tsc no pudo compilar el registro maestro:\n${`${e.stdout ?? ""}${e.stderr ?? ""}`.trim()}`
      );
    }
    const out = join(tmp, "out", "src", "lib", "seguridad");
    // tsc resuelve el alias @/ pero no lo reescribe en el JS emitido, así que
    // node no lo entiende. Se traduce a rutas relativas (con extensión) a mano.
    for (const f of MODULOS.map((m) => `${m}.js`)) {
      const ruta = join(out, f);
      writeFileSync(
        ruta,
        readFileSync(ruta, "utf8").replace(/@\/lib\/seguridad\/(\w+)/g, "./$1.js"),
        "utf8"
      );
    }
    const salida = {};
    for (const m of MODULOS) {
      Object.assign(salida, await import(pathToFileURL(join(out, `${m}.js`)).href));
    }
    return salida;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
