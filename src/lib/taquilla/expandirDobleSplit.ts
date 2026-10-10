export type LineaExpandida = {
  linea: string;
  cliente1: string;
  jugada1: string;
  caballo: string;
  cliente2: string;
  monto: string;
};

const MONTO_REGEX = /[\d]+(?:[.,]\d+)?$/;
const PATRON_DOBLE = /(\d+[a-z]{0,3}(?:\/\d+[a-z]{0,3})*)-(\d+[a-z]{0,3}(?:\/\d+[a-z]{0,3})*)/i;

/**
 * Expande líneas con patrón tipo "2y3-3n" o "1p-1y2": divide el monto entre ambas jugadas
 */
export function expandirLineasDobleSplit(lineas: string[]): LineaExpandida[] {
  const resultado: LineaExpandida[] = [];
  for (const raw of lineas) {
    const linea = raw.trim();
    if (!linea || linea.startsWith("#")) continue;
    const mPatron = linea.match(PATRON_DOBLE);
    if (!mPatron) continue;

    const idxPatron = mPatron.index ?? 0;
    const parteIzq = linea.slice(0, idxPatron).trim();
    const resto = linea.slice(idxPatron + mPatron[0].length).trim();

    let jugada1 = mPatron[1].toLowerCase();
    let jugada2 = mPatron[2].toLowerCase();

    // Normalizar formatos comunes
    jugada1 = jugada1.replace(/-/g, "/");
    jugada2 = jugada2.replace(/-/g, "/");

    const mMonto = resto.match(MONTO_REGEX);
    if (!mMonto) continue;
    const montoStr = mMonto[0].replace(",", ".");
    const montoNum = parseFloat(montoStr);
    if (!Number.isFinite(montoNum) || montoNum <= 0) continue;

    const mitad = montoNum / 2;
    const monto1 = mitad % 1 === 0 ? String(Math.round(mitad)) : mitad.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const monto2 = monto1;

    const restoSinMonto = resto.slice(0, mMonto.index).trim();
    const tokens = restoSinMonto.split(/\s+/);
    if (tokens.length < 2) continue;
    const caballo = tokens[0];
    const cliente2 = tokens.slice(1).join(" ");

    const cliente1 = parteIzq.replace(/\s+$/, "");

    resultado.push({
      linea: `${cliente1} ${jugada1} ${caballo} ${cliente2} ${monto1}`.replace(/\s+/g, " "),
      cliente1,
      jugada1,
      caballo,
      cliente2,
      monto: monto1,
    });
    resultado.push({
      linea: `${cliente1} ${jugada2} ${caballo} ${cliente2} ${monto2}`.replace(/\s+/g, " "),
      cliente1,
      jugada1: jugada2,
      caballo,
      cliente2,
      monto: monto2,
    });
  }
  return resultado;
}

export function tieneDobleSplit(linea: string): boolean {
  return /\d+[ypn]?\/\d+[ypn]?-\d+[ypn]?\b/i.test(linea.trim()) || /\d+[ypn]?-\d+[ypn]?\b/i.test(linea.trim()) && !linea.trim().match(/^(\d+)([pn])?$/i);
}
