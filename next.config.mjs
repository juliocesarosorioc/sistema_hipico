import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPA Next.js que convive con el sistema legacy (html/ + css/ + js/).
 *
 * `output: "export"` → build 100% ESTÁTICO (HTML/JS/CSS puro). Esto:
 *   1) se sirve junto a los archivos legacy sin necesitar un servidor Node,
 *   2) elimina TODOS los módulos virtuales de runtime que rompen el build
 *      en este Windows (`private-next-instrumentation-*`, statically collected
 *      page data), y
 *   3) es el modelo de despliegue del sistema hípico (estático por diseño).
 *
 * El alias "@" se fuerza DIRECTAMENTE en webpack (no se confía en tsconfig
 * paths, que webpack a veces no aplica a layout/server components):
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  images: { unoptimized: true },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": src,
      "@/components": path.join(src, "components"),
      "@/app": path.join(src, "app"),
      "@/store": path.join(src, "store"),
      "@/lib": path.join(src, "lib"),
    };
    return config;
  },
};

export default nextConfig;
