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

hijo.on("exit", (code) => process.exit(code ?? 0));