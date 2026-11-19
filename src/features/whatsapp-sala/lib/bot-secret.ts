import { timingSafeEqual } from "node:crypto";

/**
 * Secreto interno servidor→demonio Baileys / rutas internas.
 *
 * SOLO servidor (rutas API y servicios). Nunca importar desde componentes de
 * navegador. No existe valor de respaldo: si `INTERNAL_BOT_SECRET` no está
 * configurado la operación se aborta (fail-closed).
 */
export class SecretoInternoBotNoConfiguradoError extends Error {
  constructor() {
    super(
      "INTERNAL_BOT_SECRET no configurado: operación abortada (fail-closed)."
    );
    this.name = "SecretoInternoBotNoConfiguradoError";
  }
}

export function obtenerSecretoInternoBot(): string {
  const secreto = String(process.env.INTERNAL_BOT_SECRET ?? "").trim();
  if (!secreto) throw new SecretoInternoBotNoConfiguradoError();
  return secreto;
}

/** Comparación en tiempo constante del header `x-internal-bot-secret`. */
export function esSecretoInternoBotValido(
  cabecera: string | null | undefined
): boolean {
  if (typeof cabecera !== "string" || !cabecera) return false;
  const esperado = obtenerSecretoInternoBot();
  const recibido = Buffer.from(cabecera);
  const configurado = Buffer.from(esperado);
  if (recibido.length !== configurado.length) return false;
  return timingSafeEqual(recibido, configurado);
}
