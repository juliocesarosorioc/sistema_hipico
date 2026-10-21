import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuración de Next.js que convive con el sistema legacy (html/ + css/ + js/).
 *
 * Hay DOS modos de build, y la diferencia no es cosmética: decide si existe o
 * no una capa de autenticación en el SERVIDOR.
 *
 * 1) MODO SERVIDOR (por defecto) — `npm run build` + `npm start`
 *      NO define `output`, así que Next produce un build de servidor y
 *      `src/middleware.ts` SE EJECUTA. Cada ruta protegida se valida antes de
 *      entregar una sola línea de HTML. Es el modo recomendado para una
 *      herramienta con datos de clientes y saldos.
 *
 * 2) MODO ESTÁTICO — `npm run build:export`
 *      Define `NEXT_OUTPUT=export` y produce HTML/JS/CSS puro, para servirse
 *      junto a los archivos legacy sin depender de Node.
 *      OJO: Next elimina el middleware en el build estático (por eso el error
 *      "Middleware cannot be used with output: export"). En este modo la
 *      frontera de seguridad es la sesión de Supabase + las políticas RLS de
 *      `src/core/db/seguridad_maestro.sql` (que deben validar por auth.uid()), y los
 *      guardas del cliente son solo de experiencia de usuario.
 *
 * El alias "@" se fuerza DIRECTAMENTE en webpack (no se confía en tsconfig
 * paths, que webpack a veces no aplica a layout/server components):
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");

const esExportEstatico = process.env.NEXT_OUTPUT === "export";

/**
 * `trailingSlash` SOLO en el build estático.
 *
 * Sin esto, Next exporta cada ruta como `out/portal.html`. GitHub Pages sirve
 * `/portal` y `/portal.html`, pero NO reescribe la barra final: `/portal/`
 * responde 404 (y es la forma en la que se comparte un enlace de carpeta).
 * Con `trailingSlash: true` el export usa carpetas —`out/portal/index.html`—
 * y entonces `/portal`, `/portal/` y `/portal.html` caen todos en el mismo
 * archivo. En modo servidor no se toca: ahí las rutas las resuelve Next.
 */
const trailingSlash = esExportEstatico;

/**
 * Subpath del despliegue. GitHub Pages sirve el sitio en
 * `https://<usuario>.github.io/sistema_hipico/`, así que en ese modo la app se
 * construye con `basePath=/sistema_hipico` (Next prefija los enlaces y los
 * assets). Con la variable vacía (dev, `next start`, o el export que convive
 * con el legacy en la raíz) todo queda relativo a `/`.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "")
  .replace(/\/+$/, "")
  .replace(/\/+/g, "/");

const nextConfig = {
  reactStrictMode: true,
  ...(esExportEstatico ? { output: "export", trailingSlash } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: true },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": src,
      "@/app": path.join(src, "app"),
      "@/shared": path.join(src, "shared"),
      "@/core": path.join(src, "core"),
      "@/features": path.join(src, "features"),
    };
    return config;
  },
};

export default nextConfig;