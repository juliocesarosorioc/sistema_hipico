/**
 * EXPANSIÓN DE JUGADAS COMPUESTAS CON GUION (módulo PURO, sin I/O ni React).
 *
 * La casa anota una jugada combinada como una sola pieza separada por guion,
 * por ejemplo "Walcot 2y3-3n 4 astronauta 400" o "Ramon 1p-1y2 3 mar 500".
 * La Carga Individual, en cambio, trabaja una jugada por fila; este módulo
 * parte esa pieza en DOS líneas coherentes y reparte el monto 50/50.
 *
 *   "Ramon 1p-1y2 3 mar 500"
 *     → "Ramon 1p 3 mar 250"
 *     → "Ramon 1y2 3 mar 250"
 *
 * COHERENCIA (pedido del operador): una jugada "sola sin número" es basura y
 * NO debe expandirse a ciegas dejando una línea rota (el bug histórico: la
 * pieza "1y2" se recortaba a "1y" y el "2" terminaba como caballo). Por eso
 * solo se aceptan piezas con la MISMA gramática del parser (taquilla/validar)
 * y, cuando una línea no cuadra, se devuelve como incoherencia para pedir la
 * corrección en el modal.
 */

export type LineaExpandida = {
  linea: string;
  cliente1: string;
  jugada1: string;
  caballo: string;
  cliente2: string;
  monto: string;
};

/**
 * Modalidad canónica de la casa (idéntica a la del parser):
 *   P/N      → 2p · 3n
 *   Y        → 1y2 · 3y3 · 1y2n
 *   X (pareo)→ 2x3 · 6x7
 *   PP       → pp (a la par)
 *   Barra    → 2/3n · 10/8 · 10/2.5 · 10/2,5
 *   A premio → 10a8 · 10A2.5 · 10a2,5
 * Cualquier otra forma (ej. "1y", "3/") es INCOHERENTE.
 */
const RE_JUGADA_CANONICA =
  /^(?:\d+y\d+[pn]?|\d+x\d+|\d+[pn]|pp|\d+(?:[.,]\d+)?\/\d+(?:[.,]\d+)?[pn]?|\d+(?:[.,]\d+)?[aA]\d+(?:[.,]\d+)?)$/i;

/** Misma gramática, sin anclas, para armar el patrón con guion. */
const PIEZA_JUGADA = String.raw`(?:\d+y\d+[pn]?|\d+x\d+|\d+[pn]|pp|\d+(?:[.,]\d+)?\/\d+(?:[.,]\d+)?[pn]?|\d+(?:[.,]\d+)?[aA]\d+(?:[.,]\d+)?)`;

/** Patrón compuesto: PIEZA - PIEZA (ej. "1p-1y2", "2y3-3n"). */
const PATRON_DOBLE = new RegExp(`(${PIEZA_JUGADA})-(${PIEZA_JUGADA})`, "i");

/** Monto: número (con decimales opcionales) al final de la línea. */
const MONTO_REGEX = /\d+(?:[.,]\d+)?$/;

/** ¿La jugada respeta la gramática canónica de la casa? */
export function esJugadaCoherente(jugada: string): boolean {
  return RE_JUGADA_CANONICA.test(String(jugada ?? "").trim());
}

/** Mismo patrón canónico, sin anclas, para detectar la pieza suelta de un guion. */
function piezaRotaEn(tok: string): boolean {
  const p = String(tok ?? "").trim();
  if (!p || /^\d+$/.test(p)) return false; // número pelado no es una jugada
  if (esJugadaCoherente(p)) return false;
  if (/^\d+\/\d+(?:[.,]\d+)?$/.test(p)) return false; // proporción de cruce válida
  return /^\d+/.test(p); // arranca en dígito pero no respeta la gramática
}

/** Token que "parece" una jugada: arranca en dígitos y trae letra de apuesta. */
const TOKEN_JUGADA_CANDIDATA = /^\d+[yxpna/][a-z0-9/.,-]*$/i;

/** ¿Es charla de apuesta al final? Dice qué falta en la jugada rota. */
function motivoJugadaRota(tok: string): string {
  if (/[y]$/i.test(tok)) return `falta el segundo número (¿${tok}nº?)`;
  if (/[x]$/i.test(tok)) return `falta el segundo número (¿${tok}3?)`;
  if (/\/$/.test(tok)) return `falta el número después de la barra (¿${tok}3?)`;
  return "jugada incompleta, revisá la nomenclatura";
}

export type IncoherenciaLinea = {
  linea: string;
  motivos: string[];
};

/**
 * Revisa el bloque de Carga Rápida y devuelve, por línea, los motivos por los
 * que una jugada quedó INCOHERENTE. El objetivo es pedir la corrección antes
 * de poblar la tabla en vez de dejar pasar una jugada a medias.
 *
 * Casos que marca:
 *   · Jugada "sola sin número": "1y", "2x", "3/" (falta el segundo número).
 *   · Guion combinado que no se puede partir en dos jugadas válidas ("1p-1y").
 *   La jugada válida completa ("1p-1y2", "2y3-3n") nunca se marca: esa se
 *   expande en dos líneas coherentes.
 */
export function revisarCoherenciaLineas(lineas: string[]): IncoherenciaLinea[] {
  const salida: IncoherenciaLinea[] = [];
  for (const raw of lineas) {
    const linea = String(raw ?? "").trim().replace(/^\s*\d+\s*\)\s*/, "");
    if (!linea || linea.startsWith("#")) continue;
    const motivos = new Set<string>();

    for (const bruto of linea.split(/\s+/)) {
      const tok = bruto.replace(/[.,;]+$/, "");
      if (!TOKEN_JUGADA_CANDIDATA.test(tok)) continue;

      const piezas = tok.split("-");
      if (piezas.length >= 2) {
        // Guion: cada lado debe ser una jugada completa válida.
        if (piezas.every((p) => esJugadaCoherente(p))) continue; // doble jugada OK
        const rotas = piezas.filter(piezaRotaEn);
        if (rotas.length === 0) continue;
        motivos.add(
          `el guion «${tok}» no se pudo separar en dos jugadas válidas: ${rotas
            .map((p) => `«${p}» ${motivoJugadaRota(p)}`)
            .join(", ")}`
        );
        continue;
      }

      if (esJugadaCoherente(tok)) continue;
      if (/^\d+(?:[.,]\d+)?[\/aA]\d+(?:[.,]\d+)?$/.test(tok)) continue; // proporción de cruce / A Premio válida
      motivos.add(`«${tok}»: ${motivoJugadaRota(tok)}`);
    }

    if (motivos.size > 0) salida.push({ linea, motivos: [...motivos] });
  }
  return salida;
}

/** Mitad del monto, sin ceros sobrantes ("500" → "250", "401" → "200.5"). */
function formatearMitad(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Expande las líneas que contienen una jugada compuesta con guion.
 * Devuelve [] para las líneas sin guion o cuando la pieza no es coherente
 * (así el caller conserva la línea original y la marca para corregir).
 */
export function expandirLineasDobleSplit(lineas: string[]): LineaExpandida[] {
  const resultado: LineaExpandida[] = [];
  for (const raw of lineas) {
    const linea = String(raw ?? "").trim();
    if (!linea || linea.startsWith("#")) continue;

    const m = PATRON_DOBLE.exec(linea);
    if (!m) continue;

    const jugada1 = m[1].toLowerCase();
    const jugada2 = m[2].toLowerCase();
    // Ambas piezas deben ser jugadas completas; si una no cuadra, NO se
    // expande (la línea entera queda para corregir en la vista previa).
    if (!esJugadaCoherente(jugada1) || !esJugadaCoherente(jugada2)) continue;

    const idx = m.index;
    const cliente1 = linea.slice(0, idx).trim();
    const resto = linea.slice(idx + m[0].length).trim();

    const mMonto = MONTO_REGEX.exec(resto);
    if (!mMonto) continue;
    const montoNum = parseFloat(mMonto[0].replace(",", "."));
    if (!Number.isFinite(montoNum) || montoNum <= 0) continue;

    const restoSinMonto = resto.slice(0, mMonto.index).trim();
    const tokens = restoSinMonto.split(/\s+/).filter(Boolean);
    // Necesitamos al menos el CABALLO; el CLIENTE 2 puede faltar y el módulo
    // lo marcará como "revisar" en su propia validación.
    if (tokens.length < 1) continue;
    const caballo = tokens[0];
    const cliente2 = tokens.slice(1).join(" ");

    const monto = formatearMitad(montoNum / 2);
    const armar = (jugada: string) =>
      `${cliente1} ${jugada} ${caballo} ${cliente2} ${monto}`.replace(/\s+/g, " ").trim();

    resultado.push({ linea: armar(jugada1), cliente1, jugada1, caballo, cliente2, monto });
    resultado.push({ linea: armar(jugada2), cliente1, jugada1: jugada2, caballo, cliente2, monto });
  }
  return resultado;
}

/** ¿La línea trae una jugada compuesta válida que se puede expandir? */
export function tieneDobleSplit(linea: string): boolean {
  const m = PATRON_DOBLE.exec(String(linea ?? ""));
  return !!m && esJugadaCoherente(m[1]) && esJugadaCoherente(m[2]);
}
