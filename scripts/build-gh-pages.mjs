/**
 * Build ESTÁTICO para GitHub Pages.
 *
 * GitHub Pages sirve el repositorio en `https://<usuario>.github.io/sistema_hipico/`,
 * es decir, bajo un SUBPATH. Este script es igual a `build:export` pero además
 * informa `NEXT_PUBLIC_BASE_PATH=/sistema_hipico`, que `next.config.mjs` usa
 * como `basePath`+`assetPrefix` para que los enlaces y los assets apunten bien.
 *
 * Recordatorio de seguridad (igual que build:export): el build estático NO
 * incluye `src/middleware.ts`. En GitHub Pages no hay capa de servidor: la
 * frontera real es la sesión de Supabase + las políticas RLS de la base.
 */
import { spawn } from "node:child_process";

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

hijo.on("exit", (code) => process.exit(code ?? 0));