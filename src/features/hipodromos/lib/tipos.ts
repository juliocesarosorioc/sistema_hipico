/** Tipos del módulo Hipódromos (mismas columnas de la tabla `hipodromos`). */

export type Hipodromo = {
  id: string | number;
  nombre: string;
  pais: string;
  estado: string;
  /**
   * Logo del hipódromo (Data URL PNG base64, optimizado en el cliente).
   * Se muestra en el Reporte de Liquidación y en la lista del módulo.
   */
  logo_url?: string | null;
  fecha_creacion?: string | null;
  /**
   * Fecha de BAJA LÓGICA. Con valor, el hipódromo está archivado: no se ofrece
   * en ningún selector, pero la fila y todo su historial (carreras, tablas,
   * tickets, liquidaciones) siguen ahí. `null` = vigente.
   */
  eliminado_en?: string | null;
  eliminado_por?: string | null;
};

/** Los tres estados que el catálogo maneja. */
export const ESTADOS_HIPODROMO = ["Activo", "Inactivo", "Suspendido"] as const;
export type EstadoHipodromo = (typeof ESTADOS_HIPODROMO)[number];

/** Normaliza lo que venga de la base (puede ir en minúsculas o vacío). */
export function normalizarEstado(estado: unknown): EstadoHipodromo {
  const e = String(estado ?? "").trim();
  const porIndice = ESTADOS_HIPODROMO.find((x) => x.toLowerCase() === e.toLowerCase());
  return porIndice ?? "Activo";
}

/** ¿Está dado de baja (archivado)? */
export function estaBorrado(h: Pick<Hipodromo, "eliminado_en"> | null | undefined): boolean {
  return Boolean(String(h?.eliminado_en ?? "").trim());
}

/** ¿Se ofrece en los módulos de jugadas? Solo los activos y no archivados. */
export function esOperativo(h: Hipodromo | null | undefined): boolean {
  if (!h) return false;
  return !estaBorrado(h) && normalizarEstado(h.estado) === "Activo";
}

/** Etiqueta + clase de color del chip de estado. */
export function etiquetaEstado(h: Hipodromo): { texto: string; clase: string } {
  if (estaBorrado(h)) return { texto: "Archivado", clase: "bg-slate-200 text-slate-600" };
  switch (normalizarEstado(h.estado)) {
    case "Activo":
      return { texto: "Activo", clase: "bg-emerald-100 text-emerald-700" };
    case "Suspendido":
      return { texto: "Suspendido", clase: "bg-amber-100 text-amber-800" };
    default:
      return { texto: "Inactivo", clase: "bg-slate-200 text-slate-600" };
  }
}

/** País con bandera (reutiliza la paleta de banderas de la SPA). */
export const PAISES = ["VE", "USA", "PA", "MX", "AR", "BR", "CL", "PE", "CO", "EC", "UY", "OTRO"] as const;

export type ResListar = { ok: boolean; data: Hipodromo[]; error?: string; local?: boolean };
export type ResCrud = { ok: boolean; error?: string; code?: string; reactivado?: boolean };

/** Título formateado: cada palabra con su inicial en MAYÚSCULA ("La Rinconada",
 *  "Del Mar", "Santa Anita").
 *
 *  Antes se bajaban los artículos al estilo del legacy ("la Rinconada"), pero en
 *  pantalla y al guardar el nombre tiene que verse como nombre propio, con la
 *  primera letra en mayúscula. Sigue colapsando espacios y siendo idempotente,
 *  que es de lo que depende la detección de duplicados y la reactivación por
 *  nombre. */
/**
 * Diccionario canónico de hipódromos reconocidos para respetar la redacción
 * exacta con sus espacios y mayúsculas, incluso si la clave viene pegada
 * ("GULFSTREAMPARK", "Gulfstreampark") o con variantes ("Hollywood Charles Town").
 */
export const NOMBRES_CANONICOS_HIPODROMOS: Record<string, string> = {
  CHARLESTOWN: "Charles Town",
  HOLLYWOODCHARLESTOWN: "Charles Town",
  GULFSTREAM: "Gulfstream Park",
  GULFSTREAMPARK: "Gulfstream Park",
  LARINCONADA: "La Rinconada",
  SANTARITA: "Santa Rita",
  SANTAANITA: "Santa Anita",
  SANTAANITAPARK: "Santa Anita",
  DELMAR: "Del Mar",
  CHURCHILLDOWNS: "Churchill Downs",
  BELMONT: "Belmont Park",
  BELMONTPARK: "Belmont Park",
  TAMPABAY: "Tampa Bay Downs",
  TAMPABAYDOWNS: "Tampa Bay Downs",
  PARX: "Parx Racing",
  PARXRACING: "Parx Racing",
  FAIRGROUNDS: "Fair Grounds",
  GOLDENGATE: "Golden Gate Fields",
  GOLDENGATEFIELDS: "Golden Gate Fields",
  PENNNATIONAL: "Penn National",
  SAMHOUSTON: "Sam Houston",
  MAHONINGVALLEY: "Mahoning Valley",
  MOUNTAINEER: "Mountaineer",
  REMINGTON: "Remington Park",
  REMINGTONPARK: "Remington Park",
  TURFWAY: "Turfway Park",
  TURFWAYPARK: "Turfway Park",
  OAKLAWN: "Oaklawn Park",
  OAKLAWNPARK: "Oaklawn Park",
  MONMOUTH: "Monmouth Park",
  MONMOUTHPARK: "Monmouth Park",
  LAUREL: "Laurel Park",
  LAURELPARK: "Laurel Park",
  SUNLAND: "Sunland Park",
  SUNLANDPARK: "Sunland Park",
  LONESTAR: "Lone Star Park",
  LONESTARPARK: "Lone Star Park",
  DELTADOWNS: "Delta Downs",
  EVANGELINEDOWNS: "Evangeline Downs",
  COLONIALDOWNS: "Colonial Downs",
  KENTUCKYDOWNS: "Kentucky Downs",
  PRESQUEISLE: "Presque Isle Downs",
  PRESQUEISLEDOWNS: "Presque Isle Downs",
  CANTERBURYPARK: "Canterbury Park",
  EMERALDDOWNS: "Emerald Downs",
  LOSALAMITOS: "Los Alamitos",
  RANCHOALEGRE: "Rancho Alegre",
  FINGERLAKES: "Finger Lakes",
  HORSESHOEINDIANAPOLIS: "Horseshoe Indianapolis",
  INDIANAGRAND: "Horseshoe Indianapolis",
  WOODBINE: "Woodbine",
  KEENELAND: "Keeneland",
  AQUEDUCT: "Aqueduct",
  SARATOGA: "Saratoga",
  VALENCIA: "Valencia",
  HAWTHORNE: "Hawthorne",
  PIMLICO: "Pimlico",
};

/**
 * Normaliza cualquier variante de un nombre de hipódromo a su redacción propia
 * canónica (separando palabras pegadas y unificando alias como Hollywood Charles Town).
 */
export function normalizarNombreHipodromo(t: unknown): string {
  const crudo = String(t ?? "").trim();
  if (!crudo) return "";

  const clave = crudo
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  if (clave.includes("CHARLESTOWN")) {
    return "Charles Town";
  }
  if (clave === "GULFSTREAM" || clave === "GULFSTREAMPARK" || clave.startsWith("GULFSTREAM")) {
    return "Gulfstream Park";
  }

  if (NOMBRES_CANONICOS_HIPODROMOS[clave]) {
    return NOMBRES_CANONICOS_HIPODROMOS[clave];
  }

  return crudo
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-záéíóúñ]|\b\d+\b/g, (m) => m.toUpperCase());
}

export function formatearNombre(t: string): string {
  return normalizarNombreHipodromo(t);
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