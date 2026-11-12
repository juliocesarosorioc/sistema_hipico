/**
 * Mensajes oficiales de apertura/cierre de carrera y parser de pizarra LLEGADA.
 */

export function formatearOrdinalCarrera(numero: number | string): string {
  const n = Math.trunc(Number(numero)) || 1;
  const especiales: Record<number, string> = {
    1: "1ra",
    2: "2da",
    3: "3ra",
    4: "4ta",
    5: "5ta",
    6: "6ta",
    7: "7ma",
    8: "8va",
    9: "9na",
    10: "10ma",
    11: "11ma",
    12: "12da",
    13: "13ra",
  };
  if (especiales[n]) return especiales[n];
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}ra`;
  if (mod10 === 2) return `${n}da`;
  if (mod10 === 3) return `${n}ra`;
  if (mod10 === 7) return `${n}ma`;
  if (mod10 === 8) return `${n}va`;
  if (mod10 === 9) return `${n}na`;
  if (mod10 === 0) return `${n}ma`;
  return `${n}ta`;
}

export function formatearNombreHipodromoTitulo(hipodromo: string): string {
  const limpio = String(hipodromo || "").trim();
  if (!limpio) return "Hipódromo";
  return limpio
    .toLowerCase()
    .replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase());
}

export function construirMensajeCarreraAbierta(hipodromo: string, numeroCarrera: number | string): string {
  const hipo = formatearNombreHipodromoTitulo(hipodromo);
  const ord = formatearOrdinalCarrera(numeroCarrera);
  return `🏆🏇${hipo}, ${ord} Carrera🏆🏇\nCARRERA ABIERTA Y EN JUEGO\nMucha suerte a todos.`;
}

export function construirMensajeCarreraCerrada(hipodromo: string, numeroCarrera: number | string): string {
  const hipo = formatearNombreHipodromoTitulo(hipodromo);
  const ord = formatearOrdinalCarrera(numeroCarrera);
  return `${hipo}, ${ord} Carrera\nCARRERA CERRADA\n\nPUEDE ESCRIBIR LA PIZARRA: LLEGADA 1RO-2DO-3RO-4TO.`;
}

export interface PizarraParseada {
  primero: string;
  segundo?: string;
  tercero?: string;
  cuarto?: string;
  quinto?: string;
}

/**
 * Reconoce comandos de llegada/pizarra escritos por el operador en el chat o WhatsApp:
 * Ej: "LLEGADA 5-2-7-1", "LLEGADA: 5 2 7 1", "PIZARRA 5-2-7-1"
 */
export function parsearPizarraLlegadaTexto(texto: string): PizarraParseada | null {
  const limpio = String(texto || "").trim();
  const match = /^(?:llegada|pizarra)\s*[:=\-]?\s*([0-9]+(?:\s*[-,./·\s]\s*[0-9]+){1,4})\s*\.?$/i.exec(limpio);
  if (!match) return null;
  const nums = match[1]
    .split(/[-,./·\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  if (nums.length < 2) return null;
  return {
    primero: nums[0],
    segundo: nums[1],
    tercero: nums[2],
    cuarto: nums[3],
    quinto: nums[4],
  };
}
