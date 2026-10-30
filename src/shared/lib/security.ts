/**
 * Utilidades de seguridad cliente/servidor compartidas (OWASP ASVS aligned)
 */

export type FortalezaClave = {
  score: number; // 0-4
  label: string;
  color: string;
  suggestions: string[];
};

export function sanitizarTexto(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim()
    .slice(0, max);
}

export function sanitizarIdentificador(input: unknown, max = 64): string {
  if (typeof input !== "string") return "";
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .trim()
    .slice(0, max);
}

export function sanitizarEmail(input: unknown, max = 160): string {
  if (typeof input !== "string") return "";
  const email = input.toLowerCase().trim().slice(0, max);
  const re = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
  return re.test(email) ? email : "";
}

export function calcularFortalezaClave(clave: string): FortalezaClave {
  const c = clave || "";
  let score = 0;
  const suggestions: string[] = [];

  if (c.length >= 8) score++;
  else suggestions.push("Usá al menos 8 caracteres");
  
  if (c.length >= 12) score++;
  else if (c.length >= 8) suggestions.push("Recomendado: 12+ caracteres para mayor seguridad");
  
  if (/[a-z]/.test(c) && /[A-Z]/.test(c)) score++;
  else suggestions.push("Incluí mayúsculas y minúsculas");
  
  if (/\d/.test(c)) score++;
  else suggestions.push("Incluí al menos un número");
  
  if (/[^A-Za-z0-9]/.test(c)) score++;
  else suggestions.push("Incluí al menos un símbolo (!@#$%...)");

  // Penalizar patrones comunes
  if (/^(password|123456|qwerty|admin)/i.test(c)) {
    score = Math.max(0, score - 2);
    suggestions.push("Evitá contraseñas o patrones comunes");
  }

  score = Math.min(4, Math.max(0, score));

  const labels = ["Muy débil", "Débil", "Aceptable", "Fuerte", "Muy fuerte"];
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500", "bg-emerald-600"];

  return {
    score,
    label: labels[score],
    color: colors[score],
    suggestions: suggestions.slice(0, 3)
  };
}

export function esPinValido(pin: string, min = 4, max = 8): { ok: boolean; error?: string } {
  const p = String(pin ?? "");
  if (!p.trim()) return { ok: false, error: "Escribí el PIN de acceso." };
  if (p.length < min) return { ok: false, error: `El PIN debe tener al menos ${min} dígitos/caracteres.` };
  if (p.length > max) return { ok: false, error: `El PIN no puede superar ${max} caracteres.` };
  if (/\s/.test(p)) return { ok: false, error: "El PIN no puede contener espacios." };
  // Permitir alfanumérico para mayor flexibilidad
  if (/[^A-Za-z0-9]/.test(p)) return { ok: false, error: "El PIN solo puede contener letras y números." };
  return { ok: true };
}

export class RateLimiterCliente {
  private intentos: number[] = [];
  private bloqueadoHasta: number = 0;

  constructor(
    private maxIntentos = 5,
    private ventanaMs = 5 * 60 * 1000,
    private bloqueoMs = 15 * 60 * 1000
  ) {}

  puedeIntentar(): { ok: boolean; segundosRestantes?: number } {
    const ahora = Date.now();
    if (this.bloqueadoHasta > ahora) {
      const seg = Math.ceil((this.bloqueadoHasta - ahora) / 1000);
      return { ok: false, segundosRestantes: seg };
    }
    // Limpiar intentos viejos
    this.intentos = this.intentos.filter(t => ahora - t < this.ventanaMs);
    if (this.intentos.length >= this.maxIntentos) {
      this.bloqueadoHasta = ahora + this.bloqueoMs;
      return { ok: false, segundosRestantes: Math.ceil(this.bloqueoMs / 1000) };
    }
    return { ok: true };
  }

  registrarFallo() {
    this.intentos.push(Date.now());
  }

  registrarExito() {
    this.intentos = [];
    this.bloqueadoHasta = 0;
  }
}

export function generarTokenCsrf(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
