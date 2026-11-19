export interface HipodromoCatalogo {
  id?: string;
  nombre: string;
  activo?: boolean | null;
}

export interface CoincidenciaHipodromo extends HipodromoCatalogo {
  score: number;
}

/** Minúsculas, sin tildes y sin puntuación: base común para todos los scores. */
export function normalizarTextoHipodromo(raw?: string | null): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^hipodromo\s+/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigramas(texto: string): string[] {
  if (texto.length < 2) return texto ? [texto] : [];
  const salida: string[] = [];
  for (let i = 0; i < texto.length - 1; i += 1) salida.push(texto.slice(i, i + 2));
  return salida;
}

export function similitudDice(a: string, b: string): number {
  const na = normalizarTextoHipodromo(a);
  const nb = normalizarTextoHipodromo(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ba = bigramas(na);
  const bb = bigramas(nb);
  if (!ba.length || !bb.length) return 0;

  const conteo = new Map<string, number>();
  for (const g of ba) conteo.set(g, (conteo.get(g) || 0) + 1);
  let interseccion = 0;
  for (const g of bb) {
    const n = conteo.get(g) || 0;
    if (n > 0) {
      interseccion += 1;
      conteo.set(g, n - 1);
    }
  }
  return (2 * interseccion) / (ba.length + bb.length);
}

export function distanciaLevenshtein(a: string, b: string): number {
  const na = normalizarTextoHipodromo(a);
  const nb = normalizarTextoHipodromo(b);
  if (na === nb) return 0;
  if (!na.length) return nb.length;
  if (!nb.length) return na.length;

  let anterior = Array.from({ length: nb.length + 1 }, (_, i) => i);
  for (let i = 1; i <= na.length; i += 1) {
    const actual = [i];
    for (let j = 1; j <= nb.length; j += 1) {
      const costo = na[i - 1] === nb[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + costo);
    }
    anterior = actual;
  }
  return anterior[nb.length];
}

function puntuacionSimilitud(a: string, b: string): number {
  const na = normalizarTextoHipodromo(a);
  const nb = normalizarTextoHipodromo(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  if (na.includes(nb) || nb.includes(na)) {
    const corto = Math.min(na.length, nb.length);
    const largo = Math.max(na.length, nb.length);
    return 0.9 + 0.09 * (corto / largo);
  }

  const dice = similitudDice(na, nb);
  const levenshtein = 1 - distanciaLevenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(dice, levenshtein);
}

/**
 * Devuelve la coincidencia más cercana del catálogo con score >= 0.55.
 * Acepta nombres simples o filas `{ id, nombre }` de `public.hipodromos`.
 */
export function resolverHipodromoMasCercano(
  textoEntrada: string | null | undefined,
  listaHipodromos: Array<string | HipodromoCatalogo>
): CoincidenciaHipodromo | null {
  const entrada = normalizarTextoHipodromo(textoEntrada);
  if (!entrada || !Array.isArray(listaHipodromos) || listaHipodromos.length === 0) return null;

  let mejor: CoincidenciaHipodromo | null = null;
  for (const item of listaHipodromos) {
    const nombre = typeof item === "string" ? item : item?.nombre;
    const score = puntuacionSimilitud(entrada, String(nombre || ""));
    if (!mejor || score > mejor.score) {
      mejor = {
        ...(typeof item === "string" ? {} : item),
        nombre: String(nombre || "").trim(),
        score,
      };
    }
  }

  return mejor && mejor.score >= 0.55 ? mejor : null;
}

/** Extrae el número de carrera y el nombre aproximado del hipódromo de un comando. */
export function extraerCarreraYHipodromo(texto: string | null | undefined): {
  hipodromoTexto: string;
  carrera: number | null;
} {
  let resto = String(texto || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^!?(?:abrir|abierta|hip[óo]dromo)(?:\s+carrera)?\s*/i, "")
    .trim();

  resto = resto
    .replace(/(?:^|\s)ret(?:irados?)?\s*[:=]?\s*[0-9\s,./·#-]+$/i, "")
    .trim();

  let carrera: number | null = null;
  const patrones = [
    /\b(?:carrera|carreira|#)\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:carrera)?\s*$/i,
    /^\s*(\d{1,2})\b/,
  ];
  for (const patron of patrones) {
    const hallazgo = resto.match(patron);
    if (hallazgo) {
      carrera = parseInt(hallazgo[1], 10);
      resto = `${resto.slice(0, hallazgo.index || 0)} ${resto.slice((hallazgo.index || 0) + hallazgo[0].length)}`
        .replace(/\s+/g, " ")
        .trim();
      break;
    }
  }

  return { hipodromoTexto: resto, carrera };
}
