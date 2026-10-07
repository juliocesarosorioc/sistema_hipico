/**
 * NÚCLEO PURO de retiros — sin Supabase.
 *
 * La lógica de parseo/normalización de la lista de retirados la consultan la
 * matriz de carreras, la Tabla Fija y la liquidación. Se separa de
 * `retiros.ts` (que sí escribe en la BD) para que se pueda correr en node y
 * testear: `maestro-nucleo.ts` importa de acá y así no arrastra el cliente.
 */
export type NumeroRetirado = string | number;

export const SIN_RETIRADOS = "NO HUBO RETIROS";

/** Número tolerante: "2", 2, "2.0" y "2,5" → number. */
export function num(n: unknown): number {
  const v = parseFloat(String(n ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

/** Normaliza a strings únicas ordenadas numéricamente ("2", "5", "10"). */
export function normalizarRetirados(numeros: NumeroRetirado[] | null | undefined): string[] {
  const limpio = (numeros ?? [])
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 0);
  return [...new Set(limpio)].sort((a, b) => (num(a) - num(b)) || a.localeCompare(b));
}

/** Texto canónico que se guarda en `retirados` / `retirados_oficiales`. */
export function textoRetirados(numeros: NumeroRetirado[] | null | undefined): string {
  const lista = normalizarRetirados(numeros);
  return lista.length ? lista.join(",") : SIN_RETIRADOS;
}

/**
 * Parsea tolerantemente lo que escribe el operador ("2,5" · "2 5" · "2, 5" ·
 * "2-5" · "#2 #5") y devuelve la lista de números. El rango "a-b" se expande.
 */
export function parsearRetirados(texto: string): string[] {
  const salida = new Set<string>();
  const limpio = String(texto ?? "").trim();
  if (!limpio || limpio.toUpperCase() === SIN_RETIRADOS) return [];
  // Rangos "2-5" primero (evita leer el guion como separador).
  for (const m of limpio.matchAll(/(\d+)\s*[-–—a]{1,2}\s*(\d+)/gi)) {
    const a = num(m[1]);
    const b = num(m[2]);
    if (a > 0 && b >= a && b - a <= 99) for (let i = a; i <= b; i++) salida.add(String(i));
  }
  for (const m of limpio.matchAll(/\d+/g)) salida.add(String(num(m[0])));
  return normalizarRetirados([...salida]);
}
