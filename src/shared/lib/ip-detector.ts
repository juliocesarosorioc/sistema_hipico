/**
 * Módulo de Detección y Restricción por Dirección IP
 * ---------------------------------------------------
 * Permite detectar la dirección IP pública del usuario que se conecta
 * y asegurar que los enlaces y credenciales solo se utilicen desde la
 * dirección IP autorizada.
 */

let ipCache: { ip: string; timestamp: number } | null = null;
const CACHE_MS = 60 * 1000; // 1 minuto de caché

/**
 * Obtiene la dirección IP pública del cliente conectado.
 */
export async function obtenerIpCliente(): Promise<string> {
  const ahora = Date.now();
  if (ipCache && ahora - ipCache.timestamp < CACHE_MS) {
    return ipCache.ip;
  }

  // 1. Intentar endpoint interno de Next.js
  try {
    const res = await fetch("/api/ip", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data.ip && data.ip !== "127.0.0.1" && data.ip !== "::1") {
        ipCache = { ip: data.ip, timestamp: ahora };
        return data.ip;
      }
    }
  } catch {
    /* Fallback a servicios públicos */
  }

  // 2. Fallback a ipify HTTPS rápido
  try {
    const res = await fetch("https://api64.ipify.org?format=json", {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data.ip) {
        ipCache = { ip: data.ip, timestamp: ahora };
        return data.ip;
      }
    }
  } catch {
    /* Intentar segundo fallback */
  }

  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data.ip) {
        ipCache = { ip: data.ip, timestamp: ahora };
        return data.ip;
      }
    }
  } catch {
    /* No se pudo determinar */
  }

  return "IP_LOCAL";
}

/**
 * Comprueba si la IP actual coincide con la IP autorizada para la sesión o enlace.
 * Si no hay IP autorizada previa, la actual queda como autorizada.
 */
export function validarIpSesion(
  ipActual: string,
  ipAutorizada?: string | null
): { ok: boolean; ipAutorizada: string; motivo?: string } {
  const actualLimpia = (ipActual || "").trim();
  const autorizadaLimpia = (ipAutorizada || "").trim();

  // Si no había IP registrada previamente, se asocia a la actual
  if (!autorizadaLimpia) {
    return { ok: true, ipAutorizada: actualLimpia };
  }

  // Si coinciden o son localhost de desarrollo
  if (
    actualLimpia === autorizadaLimpia ||
    actualLimpia === "IP_LOCAL" ||
    autorizadaLimpia === "IP_LOCAL"
  ) {
    return { ok: true, ipAutorizada: autorizadaLimpia };
  }

  return {
    ok: false,
    ipAutorizada: autorizadaLimpia,
    motivo: `Acceso restringido: Este enlace o sesión está autorizada exclusivamente para la IP ${autorizadaLimpia}. Tu dirección IP detectada es ${actualLimpia}. Por motivos de seguridad y prevención de clonación, solo puedes trabajar desde la dirección IP autorizada.`,
  };
}
