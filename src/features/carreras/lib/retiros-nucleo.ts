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
 * Premio de una tabla fija descontando los ejemplares retirados.
 *
 *   premioAjustado = premio × (1 − sumaRetirados / base)
 *
 * Es la fórmula del legacy (js/tablas.js) y la que usa la RPC
 * `club_liquidar_tabla_fija` con el snapshot de la venta. Vive acá (núcleo puro,
 * sin Supabase) para que la propagación de retiros y su prueba calculen
 * EXACTAMENTE lo mismo. Base 0 (tabla sin valores) → premio sin tocar.
 */
export function premioConRetiros(premio: number, base: number, sumaRetirados: number): number {
  const p = Number(premio);
  const b = Number(base);
  const s = Number(sumaRetirados);
  if (!Number.isFinite(p)) return 0;
  if (!Number.isFinite(b) || b <= 0) return p;
  return Math.max(0, p * (1 - (Number.isFinite(s) ? s : 0) / b));
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

/**
 * Extrae todos los números de ejemplar involucrados en una jugada (a partir de
 * `caballo`, `ejemplarNumero` y `nombreJugada`), normalizados sin ceros a la izquierda.
 */
export function extraerNumerosCaballoJugada(
  caballo?: unknown,
  ejemplarNumero?: unknown,
  nombreJugada?: unknown
): string[] {
  const numeros = new Set<string>();
  const agregar = (raw: unknown) => {
    const limpio = String(raw ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/^0+(?=\d)/, "");
    if (/^\d+$/.test(limpio) && Number(limpio) > 0) {
      numeros.add(limpio);
    }
  };

  if (ejemplarNumero != null && String(ejemplarNumero).trim() !== "") {
    agregar(ejemplarNumero);
  }

  const cabStr = String(caballo ?? "").trim();
  const nomStr = String(nombreJugada ?? "").trim().toUpperCase();

  if (cabStr && cabStr.toUpperCase() !== "TABLA COMPLETA") {
    if (/^DUPLETA\b/.test(nomStr) && cabStr.includes("*")) {
      // En tickets_apuestas de Dupleta, `carrera` corresponde a la 1ª pata (antes del '*').
      const primeraPata = cabStr.split("*")[0];
      for (const m of String(primeraPata ?? "").matchAll(/\d+/g)) {
        agregar(m[0]);
      }
    } else {
      for (const m of cabStr.matchAll(/\d+/g)) {
        agregar(m[0]);
      }
    }
  }

  // Respaldo cuando el ejemplar solo viene codificado en `nombreJugada`
  if (numeros.size === 0 && nomStr) {
    const mGanador = /^(\d+)G$/i.exec(nomStr);
    if (mGanador) agregar(mGanador[1]);
    const mTablaN = /\bN(\d+)\b/i.exec(nomStr);
    if (mTablaN) agregar(mTablaN[1]);
    for (const mHash of nomStr.matchAll(/#(\d+)/g)) {
      agregar(mHash[1]);
    }
  }

  return [...numeros];
}

/**
 * Determina si una jugada involucra al menos un ejemplar retirado en la carrera.
 * Si devuelve `true`, la jugada queda ANULADA / RETIRADO en todos los módulos.
 */
export function jugadaInvolucraRetirado(
  caballo: unknown,
  ejemplarNumero: unknown,
  nombreJugada: unknown,
  retirados: Iterable<string | number> | null | undefined
): boolean {
  if (!retirados) return false;
  const setRet = new Set<string>();
  for (const r of retirados) {
    const limpio = String(r ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/^0+(?=\d)/, "");
    if (limpio) setRet.add(limpio);
  }
  if (setRet.size === 0) return false;
  const ejemplares = extraerNumerosCaballoJugada(caballo, ejemplarNumero, nombreJugada);
  return ejemplares.some((e) => setRet.has(e));
}
