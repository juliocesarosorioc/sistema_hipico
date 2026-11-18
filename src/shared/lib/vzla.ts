/**
 * Helpers de pago y telefonía de Venezuela — clon de js/components/ui.js
 * (BANCOS_VZLA, PAISES_TELEFONO, METODOS_PAGO y formato regional es-VE).
 * Compartidos por Gestión de Clientes y el Portal del Cliente.
 */

export const BANCOS_VZLA: Array<{ codigo: string; nombre: string }> = [
  { codigo: "0102", nombre: "BANCO DE VENEZUELA" },
  { codigo: "0104", nombre: "BANCO VENEZOLANO DE CREDITO" },
  { codigo: "0105", nombre: "BANCO MERCANTIL" },
  { codigo: "0108", nombre: "BBVA PROVINCIAL" },
  { codigo: "0114", nombre: "BANCO OCCIDENTAL DE DESCUENTO (BOD)" },
  { codigo: "0115", nombre: "BANCO EXTERIOR" },
  { codigo: "0128", nombre: "BANCO CARONI" },
  { codigo: "0134", nombre: "BANESCO" },
  { codigo: "0137", nombre: "BANCO SOFITASA" },
  { codigo: "0138", nombre: "BANCO PLAZA" },
  { codigo: "0146", nombre: "BANCARIBE" },
  { codigo: "0151", nombre: "BANCO DEL SUR" },
  { codigo: "0156", nombre: "BANCO PICHINCHA" },
  { codigo: "0157", nombre: "BANCO SUDEBAN" },
  { codigo: "0163", nombre: "BANCO DEL TESORO" },
  { codigo: "0164", nombre: "MIBANCO" },
  { codigo: "0166", nombre: "BANCO AGRICOLA" },
  { codigo: "0171", nombre: "BANCO ACTIVO" },
  { codigo: "0172", nombre: "BANCAMIGA" },
  { codigo: "0173", nombre: "BANCO CAFETERO" },
  { codigo: "0175", nombre: "BANCO BICENTENARIO" },
  { codigo: "0191", nombre: "BANCO NACIONAL DE CREDITO (BNC)" },
];

export const PAISES_TELEFONO: Array<{ codigo: string; pais: string }> = [
  { codigo: "+58", pais: "Venezuela" },
  { codigo: "+1", pais: "EE. UU. / Canadá" },
  { codigo: "+57", pais: "Colombia" },
  { codigo: "+507", pais: "Panamá" },
  { codigo: "+52", pais: "México" },
  { codigo: "+34", pais: "España" },
  { codigo: "+51", pais: "Perú" },
  { codigo: "+56", pais: "Chile" },
  { codigo: "+54", pais: "Argentina" },
  { codigo: "+593", pais: "Ecuador" },
  { codigo: "+55", pais: "Brasil" },
  { codigo: "+44", pais: "Reino Unido" },
  { codigo: "+351", pais: "Portugal" },
  { codigo: "+39", pais: "Italia" },
  { codigo: "+49", pais: "Alemania" },
];

export const METODOS_PAGO = [
  "EFECTIVO",
  "DIVISA",
  "PAGO MÓVIL",
  "TRANSFERENCIA",
  "PAYPAL",
  "ZELLE",
  "BINANCE",
  "OTRO",
];

export const listMetodosPago = (incluirBancos = true): string[] =>
  incluirBancos
    ? [...METODOS_PAGO, ...BANCOS_VZLA.map((b) => `${b.codigo} · ${b.nombre}`)]
    : [...METODOS_PAGO];

export const esBancoVzla = (metodo: string | null | undefined): boolean => /^\d{4}\s·\s/.test(metodo ?? "");

/** Opciones únicas de código de país (sin duplicados, igual que el legacy). */
export function codigosPaisUnicos(): Array<{ codigo: string; pais: string }> {
  const vistos = new Set<string>();
  const out: Array<{ codigo: string; pais: string }> = [];
  for (const p of PAISES_TELEFONO) {
    if (!vistos.has(p.codigo)) {
      vistos.add(p.codigo);
      out.push(p);
    }
  }
  return out;
}

/** Formato regional de Venezuela: 1.234,56 (decimales con coma). */
export function formatoNumero(v: number | string | null | undefined, dec = 2): string {
  const n = parseFloat(String(v ?? ""));
  if (Number.isNaN(n) || !Number.isFinite(n))
    return (0).toLocaleString("es-VE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return n.toLocaleString("es-VE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function formatoMoneda(_m: string | null | undefined, v: number | string | null | undefined, dec = 2): string {
  return formatoNumero(v, dec);
}

/** Construye "+58 4121234567" quitando el 0 nacional inicial. */
export function componerTelefono(codigo: string | null | undefined, numero: string | null | undefined): string {
  let dig = String(numero ?? "").replace(/[^\d]/g, "");
  if (codigo === "+58" && dig.startsWith("0")) dig = dig.slice(1);
  return codigo + " " + dig;
}

/** Separa "+58 4121234567" o "584121234567" en { codigo: '+58', numero: '4121234567' }. */
export function desglosarTelefono(tel: string | null | undefined): { codigo: string; numero: string } {
  const t = String(tel ?? "").trim();
  if (!t) return { codigo: "+58", numero: "" };

  // Si ya viene con separador explícito ("+58 4241737612" o "58 424...")
  const conEspacio = t.match(/^(\+?\d{1,3})\s+([\d\s-]+)$/);
  if (conEspacio) {
    const codNorm = conEspacio[1].startsWith("+") ? conEspacio[1] : `+${conEspacio[1]}`;
    const numLimpio = conEspacio[2].replace(/[^\d]/g, "");
    if (PAISES_TELEFONO.some((p) => p.codigo === codNorm)) {
      return { codigo: codNorm, numero: numLimpio };
    }
  }

  const dig = t.replace(/[^\d]/g, "");
  // Reparar formato corrupto previo como "5842 4241737612" (14 dígitos con prefijo repetido)
  if (dig.length >= 12) {
    const u10 = dig.slice(-10);
    if ((dig.startsWith("58") || t.includes("5842")) && /^[24]/.test(u10)) {
      return { codigo: "+58", numero: u10 };
    }
  }

  // Coincidir códigos de país conocidos antes del fallback genérico
  const codigosOrdenados = [...PAISES_TELEFONO]
    .map((p) => p.codigo.replace("+", ""))
    .sort((a, b) => b.length - a.length);
  for (const codSinMas of codigosOrdenados) {
    if (dig.startsWith(codSinMas) && dig.length - codSinMas.length >= 7) {
      return { codigo: `+${codSinMas}`, numero: dig.slice(codSinMas.length) };
    }
  }

  const limpio = dig.startsWith("0") ? dig.slice(1) : dig;
  return { codigo: "+58", numero: limpio };
}

export type DatosPago = {
  banco?: string | null;
  codigo?: string | null;
  nombre?: string | null;
  tipo_cuenta?: string | null;
  numero_cuenta?: string | null;
  titular?: string | null;
  telefono?: string | null;
  dato?: string | null;
  tipo_contacto?: string | null;
  cedula_rif?: string | null;
  id_binance?: string | null;
};

/** Resumen corto para tablas: "BANESCO (0134) · CtA CORRIENTE ·••1234". */
export function resumenDatosPago(dp: DatosPago | null | undefined): string {
  if (!dp || typeof dp !== "object") return "";
  if (dp.telefono) {
    const nom = dp.banco || dp.nombre || "";
    const cod = dp.codigo ? `(${dp.codigo})` : "";
    const tlf = ` Telf •${String(dp.telefono || "").replace(/\D/g, "").slice(-4)}`;
    return `${nom} ${cod}${tlf}`.trim();
  }
  if (dp.banco || dp.codigo) {
    const banco = dp.nombre || dp.banco || "";
    const cod = dp.codigo || "";
    const num = dp.numero_cuenta
      ? ` · ${dp.tipo_cuenta || ""} ${cod}••${String(dp.numero_cuenta).replace(/\D/g, "").slice(-4)}`
      : "";
    return `${banco} (${cod})${num}`.trim();
  }
  if (dp.tipo_contacto || dp.dato) {
    return `${dp.tipo_contacto === "telefono" ? "Tlf" : dp.tipo_contacto === "correo" ? "Correo" : "Dato"}: ${dp.dato || ""}`;
  }
  return "";
}

/** Número solo dígitos, máx 16. */
export function formatearCuenta(num: string | null | undefined): string {
  const d = String(num ?? "").replace(/[^\d]/g, "").slice(0, 16);
  if (!d) return "";
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 10), d.slice(10, 14), d.slice(14, 16)].filter(Boolean).join("-");
}