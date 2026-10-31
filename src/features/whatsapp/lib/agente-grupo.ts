/**
 * Agente IA para grupos de WhatsApp — núcleo puro y testeable.
 *
 * Parsea los comandos del administrador/operador en el grupo y genera las
 * respuestas canónicas del agente. La persistencia (DB) y el envío real por
 * WhatsApp se realizan en la Edge Function `whatsapp-webhook` y en el Centro
 * WhatsApp; este módulo concentra la lógica de negocio para poder probarla.
 */

export interface ComandoApertura {
  hipodromo: string;
  carrera: number;
}

export function parsearComandoApertura(texto: string): ComandoApertura | null {
  const t = String(texto ?? "").trim();
  const m = /^abierta\s+(.+?)\s+(\d+)$/i.exec(t);
  if (!m) {
    // Soporta "Abierta C2"
    const m2 = /^abierta\s+c(\d+)$/i.exec(t);
    if (m2) {
      return { hipodromo: "GENERAL", carrera: Number(m2[1]) };
    }
    return null;
  }
  const hipodromo = m[1].trim().toUpperCase();
  const carrera = Number(m[2]);
  if (!hipodromo || !Number.isFinite(carrera) || carrera < 1) return null;
  return { hipodromo, carrera };
}

export function esComandoCierre(texto: string): boolean {
  const t = String(texto ?? "").trim().toLowerCase();
  return t === "cerrada" || t === "no va más" || t === "no va mas" || t === "cierre";
}

export function parsearPizarra(texto: string): number[] | null {
  const t = String(texto ?? "").trim();
  const m = /^(pizarra|llegada|cambio de pizarra)\s*:\s*(.+)$/i.exec(t);
  if (!m) return null;
  const partes = m[2].split(/[-,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  if (partes.length === 0) return null;
  return partes;
}

export function respuestaApertura(cmd: ComandoApertura): string {
  return `🟢 ABIERTA ${cmd.hipodromo} - CARRERA ${cmd.carrera}. Hagan sus jugadas.`;
}

export function respuestaCarreraCerrada(): string {
  return "⛔ Carrera cerrada, no se registran más jugadas.";
}

export function respuestaPizarra(pizarra: number[]): string {
  return `🏁 Pizarra oficial: ${pizarra.join("-")}. Procesando liquidación...`;
}