/**
 * Build ESTÁTICO multiplataforma: equivalente a `NEXT_OUTPUT=export next build`
 * sin depender de `cross-env` ni de que la shell del sistema sepa asignar
 * variables. Se usa para el despliegue junto al sistema legacy.
 *
 * Recordatorio de seguridad: el build estático NO incluye `src/middleware.ts`
 * (Next lo elimina y avisa con "Middleware cannot be used with output: export").
 * La frontera real en ese modo es Supabase Auth + RLS.
 *
 * Para el despliegue CON capa de servidor usar `npm run build` + `npm start`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "out");

const esWindows = process.platform === "win32";
const npx = esWindows ? "npx.cmd" : "npx";

const hijo = spawn(npx, ["next", "build"], {
  stdio: "inherit",
  shell: esWindows,
  env: { ...process.env, NEXT_OUTPUT: "export" },
});

hijo.on("error", (err) => {
  console.error("No se pudo lanzar el build estático:", err);
  process.exit(1);
});

hijo.on("exit", (code) => {
  if (code === 0 && fs.existsSync(outDir)) {
    // 1. .nojekyll
    fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
    // 2. Alias .html para cada carpeta con index.html
    const items = fs.readdirSync(outDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith("_")) {
        const idxPath = path.join(outDir, item.name, "index.html");
        const htmlPath = path.join(outDir, `${item.name}.html`);
        if (fs.existsSync(idxPath) && !fs.existsSync(htmlPath)) {
          fs.copyFileSync(idxPath, htmlPath);
        }
      }
    }
  }
  process.exit(code ?? 0);
});
