/** @type {import('next').NextConfig} */
const isGhPages = process.env.GITHUB_ACTIONS === "true";

const nextConfig = {
  poweredByHeader: false, // Oculta X-Powered-By: Next.js ante escáneres de hackers
  reactStrictMode: true,
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
  },
};

export default nextConfig;