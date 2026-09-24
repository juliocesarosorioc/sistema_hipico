/** Tipos del módulo Hipódromos (mismas columnas de la tabla `hipodromos`). */

export type Hipodromo = {
  id: string | number;
  nombre: string;
  pais: string;
  estado: string;
  fecha_creacion?: string | null;
};

/** País con bandera (reutiliza la paleta de banderas de la SPA). */
export const PAISES = ["VE", "USA", "PA", "MX", "AR", "BR", "CL", "PE", "CO", "EC", "UY", "OTRO"] as const;

export type ResListar = { ok: boolean; data: Hipodromo[]; error?: string; local?: boolean };
export type ResCrud = { ok: boolean; error?: string; code?: string };

/** Título formateado (misma regla de toTitleCase del legacy). */
export function formatearNombre(t: string): string {
  return String(t || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-záéíóúñ]|\b\d+\b/g, (m) => m.toUpperCase())
    .replace(/\b(al|del|de|la|los|las|y|en|a|o|u|por|para)\b/gi, (w) => w.toLowerCase());
}

/** Distancia de Levenshtein normalizada (0 = igual, 1 = totalmente distinto). */
export function levenshteinNorm(a: string, b: string): number {
  if (!a || !b) return 1;
  const A = a.toUpperCase().replace(/\s+/g, "");
  const B = b.toUpperCase().replace(/\s+/g, "");
  if (A === B) return 0;
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = A[i - 1] === B[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + costo);
    }
  }
  return dp[m][n] / Math.max(m, n);
}