/** @type {import('next').NextConfig} */
const isGhPages = process.env.GITHUB_ACTIONS === "true";

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
        value: "camera=(), microphone=(), geolocation=()",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ],
  },
];

const nextConfig = {
  poweredByHeader: false, // Oculta X-Powered-By: Next.js ante escáneres de hackers
  reactStrictMode: true,
<<<<<<< HEAD
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
=======
  output: isGhPages ? "export" : undefined,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  async headers() {
    if (isGhPages) return [];
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
>>>>>>> ab6b89d (feat(arquitectura): blindaje seguridad, inteligencia hipica con historial, fix carga gacetas, caballo invalidado y contabilidad NIIF)
  },
};

export default nextConfig;