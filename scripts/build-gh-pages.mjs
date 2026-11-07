/**
 * Build ESTÁTICO para GitHub Pages / Dominio Personalizado.
 *
 * Soporta simultáneamente:
 *   - Dominio raíz personalizado: https://administracionhipica.ia.ve/ (basePath = "")
 *   - Subpath de GitHub Pages: https://<usuario>.github.io/sistema_hipico/ (espejo en /sistema_hipico)
 *
 * Además post-procesa `out/`:
 *   1. Genera `CNAME` con `administracionhipica.ia.ve` para mantener el dominio personalizado vinculado.
 *   2. Crea `.nojekyll` para que GitHub Pages no ignore `_next/`.
 *   3. Genera copias `<ruta>.html` (ej. `login.html`) para evitar 404 en accesos sin trailing slash.
 *   4. Genera espejo `/sistema_hipico/_next` para compatibilidad retroactiva.
 *   5. Inyecta fallback SPA en `404.html`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "out");
const apiDir = path.join(root, "src", "app", "api");
const apiBackupDir = path.join(root, "src", "app", "_api_server_only");

// En modo export estático, ocultar temporalmente rutas API dinámicas de servidor
let apiMovida = false;
if (fs.existsSync(apiDir)) {
  fs.renameSync(apiDir, apiBackupDir);
  apiMovida = true;
}

function restaurarApi() {
  if (apiMovida && fs.existsSync(apiBackupDir)) {
    try {
      fs.renameSync(apiBackupDir, apiDir);
      apiMovida = false;
    } catch {
      /* ignore */
    }
  }
}

process.on("exit", restaurarApi);
process.on("SIGINT", () => {
  restaurarApi();
  process.exit(1);
});

const esWindows = process.platform === "win32";
const npx = esWindows ? "npx.cmd" : "npx";

// En GitHub Pages bajo juliocesarosorioc.github.io/sistema_hipico/, el basePath por defecto es /sistema_hipico
const targetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/sistema_hipico";

const hijo = spawn(npx, ["next", "build"], {
  stdio: "inherit",
  shell: esWindows,
  env: {
    ...process.env,
    NEXT_OUTPUT: "export",
    NEXT_PUBLIC_BASE_PATH: targetBasePath,
  },
});

hijo.on("error", (err) => {
  restaurarApi();
  console.error("No se pudo lanzar el build para GitHub Pages:", err);
  process.exit(1);
});

hijo.on("exit", (code) => {
  restaurarApi();
  if (code === 0) {
    postProcesarExportGithubPages();
  }
  process.exit(code ?? 0);
});

function postProcesarExportGithubPages() {
  if (!fs.existsSync(outDir)) return;
  console.log("\n[post-build] Optimizando salida para GitHub Pages & Dominio Personalizado...");

  // 1. CNAME opcional solo si se configura explícitamente CUSTOM_DOMAIN
  const cnamePath = path.join(outDir, "CNAME");
  if (process.env.CUSTOM_DOMAIN) {
    fs.writeFileSync(cnamePath, process.env.CUSTOM_DOMAIN, "utf8");
    console.log(`  ✓ CNAME creado: ${process.env.CUSTOM_DOMAIN}`);
  } else if (fs.existsSync(cnamePath)) {
    fs.unlinkSync(cnamePath);
    console.log("  ✓ CNAME omitido (el dominio principal apunta al VPS Contabo)");
  }

  // 2. Asegurar archivo .nojekyll en out/ para que GitHub Pages no ignore /_next
  const nojekyllPath = path.join(outDir, ".nojekyll");
  fs.writeFileSync(nojekyllPath, "", "utf8");
  console.log("  ✓ .nojekyll creado en out/");

  // 3. Generar alias <ruta>.html para cada carpeta con index.html (ej. out/login.html para /login)
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

  // 4. Espejo /sistema_hipico para compatibilidad total si se accede con subpath
  try {
    const subpathDir = path.join(outDir, "sistema_hipico");
    if (!fs.existsSync(subpathDir)) {
      fs.mkdirSync(subpathDir, { recursive: true });
    }
    const nextSrc = path.join(outDir, "_next");
    const nextDest = path.join(subpathDir, "_next");
    if (fs.existsSync(nextSrc) && !fs.existsSync(nextDest)) {
      fs.cpSync(nextSrc, nextDest, { recursive: true });
      console.log("  ✓ Espejo /sistema_hipico/_next creado para compatibilidad");
    }
    const idxSrc = path.join(outDir, "index.html");
    const idxDest = path.join(subpathDir, "index.html");
    if (fs.existsSync(idxSrc) && !fs.existsSync(idxDest)) {
      fs.copyFileSync(idxSrc, idxDest);
      console.log("  ✓ Espejo /sistema_hipico/index.html creado para compatibilidad");
    }
  } catch (err) {
    console.warn("  ⚠ Advertencia creando espejo subpath:", err?.message);
  }

  // 5. Fallback inteligente SPA en out/404.html
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
    if (!contenido404.includes('window.location.replace(p + "/"')) {
      contenido404 = contenido404.replace("<head>", `<head>${scriptRedireccion}`);
      fs.writeFileSync(path404, contenido404, "utf8");
      console.log("  ✓ Redirección inteligente SPA agregada a out/404.html");
    }
  }
}
