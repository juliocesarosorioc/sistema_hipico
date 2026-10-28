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

/**
 * ¿Estamos en el pipeline de GitHub Actions?
 *
 * El workflow de Pages hace el build ESTÁTICO (no hay servidor detrás), así
 * que las cabeceras de `headers()` no se pueden aplicar: Next las ignora y
 * avisa por consola. En ese entorno se omiten para que el build salga limpio
 * y sin un aviso que parece un error.
 *
 * La frontera real en ese despliegue sigue siendo la MISMA de siempre: la
 * sesión de Supabase + las políticas RLS de la base. Las cabeceras son
 * defensa en profundidad del SERVIDOR, y en un hosting estático no hay
 * servidor que las ponga.
 */
const enGitHubActions = process.env.GITHUB_ACTIONS === "true";

/**
 * Cabeceras de seguridad.
 *
 * Se aplican SOLO cuando hay capa de servidor (`next start`). En el build
 * estático no hay quién las emita.
 *
 * La CSP permite lo que la app REALMENTE usa:
 *   - `https://*.supabase.co` y `wss://*.supabase.co`: la API de Supabase y
 *     su canal de realtime (el semáforo de carreras y la auditoría en vivo).
 *   - `https://generativelanguage.googleapis.com`: la API de Gemini, que es
 *     donde se transcribe la gaceta desde el navegador.
 *
 * `script-src` incluye `'unsafe-inline'` y `'unsafe-eval'` porque Next
 * inyecta los bundles con scripts en línea y el runtime de React en
 * desarrollo los evalúa; en producción `'unsafe-eval'` no es necesario y
 * queda anotado para retirarlo cuando se pueda medir.
 */
const cabecerasSeguridad = [
  {
    source: "/:path*",
    headers: [
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), unload=*",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
          "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https:",
          "style-src 'self' 'unsafe-inline' https: data:",
          "style-src-elem 'self' 'unsafe-inline' https: data:",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data: https:",
          "connect-src 'self' https: wss: https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ],
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(esExportEstatico ? { output: "export", trailingSlash } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: true },
  async headers() {
    // Sin servidor no hay quién emita cabeceras: se omiten en el export
    // estático y en el pipeline de GitHub Pages (que es un export).
    if (esExportEstatico || enGitHubActions) return [];
    return cabecerasSeguridad;
  },
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