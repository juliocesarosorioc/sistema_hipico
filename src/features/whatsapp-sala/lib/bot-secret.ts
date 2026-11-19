/**
 * Secreto interno servidor→demonio Baileys / rutas internas.
 *
 * SOLO servidor (rutas API). Nunca importar desde componentes de navegador.
 *
 * Usa `INTERNAL_BOT_SECRET`; el valor de respaldo existe únicamente por compatibilidad con
 * `procesar/route.ts` y `bot-whatsapp-server.mjs` (que aún lo usan como default).
 * Define la variable de entorno en ambos procesos y retira el respaldo.
 */
export function obtenerSecretoInternoBot(): string {
  return process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";
}
