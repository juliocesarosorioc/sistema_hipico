/**
 * Build ESTÁTICO para GitHub Pages.
 *
 * GitHub Pages sirve el repositorio en `https://<usuario>.github.io/sistema_hipico/`,
 * es decir, bajo un SUBPATH. Este script es igual a `build:export` pero además
 * informa `NEXT_PUBLIC_BASE_PATH=/sistema_hipico`, que `next.config.mjs` usa
 * como `basePath`+`assetPrefix` para que los enlaces y los assets apunten bien.
 *
 * Además post-procesa `out/`:
 *   1. Crea `.nojekyll` para que GitHub Pages no ignore `_next/`.
 *   2. Genera copias `<ruta>.html` (ej. `login.html`) para evitar 404 en accesos sin trailing slash.
 *   3. Inyecta fallback SPA en `404.html`.
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
  env: {
    ...process.env,
    NEXT_OUTPUT: "export",
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || "/sistema_hipico",
  },
});

hijo.on("error", (err) => {
  console.error("No se pudo lanzar el build para GitHub Pages:", err);
  process.exit(1);
});

hijo.on("exit", (code) => {
  if (code === 0) {
    postProcesarExportGithubPages();
  }
  process.exit(code ?? 0);
});

function postProcesarExportGithubPages() {
  if (!fs.existsSync(outDir)) return;
  console.log("\n[post-build] Optimizando salida para GitHub Pages...");

  // 1. Asegurar archivo .nojekyll en out/ para que GitHub Pages no ignore /_next
  const nojekyllPath = path.join(outDir, ".nojekyll");
  fs.writeFileSync(nojekyllPath, "", "utf8");
  console.log("  ✓ .nojekyll creado en out/");

  // 2. Generar alias <ruta>.html para cada carpeta con index.html (ej. out/login.html para /login)
  const items = fs.readdirSync(outDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory() && !item.name.startsWith("_")) {
      const idxPath = path.join(outDir, item.name, "index.html");
      const htmlPath = path.join(outDir, `${item.name}.html`);
      if (fs.existsSync(idxPath) && !fs.existsSync(htmlPath)) {
        fs.copyFileSync(idxPath, htmlPath);
        console.log(`  ✓ Alias creado: ${item.name}.html`);
      }
    }
  }

  // 3. Fallback inteligente SPA en out/404.html
  const path404 = path.join(outDir, "404.html");
  if (fs.existsSync(path404)) {
    let contenido404 = fs.readFileSync(path404, "utf8");
    const scriptRedireccion = `<script>
      (function() {
        var p = window.location.pathname;
        if (p && !p.endsWith("/") && !p.includes(".")) {
          window.location.replace(p + "/" + window.location.search + window.location.hash);
        }
      })();
    </script>`;
    if (!contenido404.includes("window.location.replace(p + \"/\"")) {
      contenido404 = contenido404.replace("<head>", `<head>${scriptRedireccion}`);
      fs.writeFileSync(path404, contenido404, "utf8");
      console.log("  ✓ Redirección inteligente SPA agregada a out/404.html");
    }
  }
}
