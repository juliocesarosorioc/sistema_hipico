/**
 * Centro WhatsApp — utilidades, plantillas dinámicas (localStorage) y conexión
 * a Supabase (clientes, notificaciones). Clon del legacy js/whatsapp.js:
 *  - Plantillas editables con reemplazo de {nombre} {saldo} {aval} {fecha} {club}
 *  - Persistencia local + compat con la clave del legacy (club_mensajes_whatsapp)
 *  - Números limpios para wa.me (sin espacios ni +).
 */
import { supabase } from "@/lib/supabase";

export const CLUB_NOMBRE = "Club del Dinero";

export type PlantillaWsp = {
  id: string;
  label: string;
  /** Grupo de la plantilla: "envio" (selector individual) o "reporte". */
  grupo: "envio" | "reporte";
  variables: string;
  txt: string;
  /** Solo las creadas por el usuario se pueden eliminar. */
  custom?: boolean;
};

export type ClienteWsp = {
  id: string | number;
  nombre: string;
  saldo_actual: number | null;
  aval: number | null;
  telefono?: string | null;
  codigo_pais?: string | null;
};

export type RegistroWsp = {
  id?: string | number;
  created_at?: string;
  titulo?: string | null;
  mensaje?: string | null;
  cliente_nombre?: string | null;
  cliente_id?: string | number | null;
  datos?: unknown;
  estado?: string | null;
};

const CLAVE_PLANTILLAS = "sistema-hipico:whatsapp-plantillas";
/** Compat: el legacy guardaba en esta clave (grupo "Plantillas del Centro WhatsApp"). */
const CLAVE_MSJ_LEGACY = "club_mensajes_whatsapp";

export const VARIABLES_WSP = ["{nombre}", "{saldo}", "{aval}", "{fecha}", "{club}", "{lineas}", "{balance}"];

export const PLANTILLAS_DEFAULT: PlantillaWsp[] = [
  {
    id: "saldo",
    label: "Saldo actual",
    grupo: "envio",
    variables: "{nombre} {saldo} {aval} {club}",
    txt: "Hola {nombre} 👋\n\n*{club}*\n\nTu saldo actual es:\n💰 *$ {saldo} USD*\n\nAval vigente: $ {aval}\n\n¡Gracias por tu confianza!",
  },
  {
    id: "aval",
    label: "Recordatorio de aval",
    grupo: "envio",
    variables: "{nombre} {aval} {club}",
    txt: "Hola {nombre} ⚠️\n\n*{club}*\n\nTe recordamos que tienes un aval pendiente de *$ {aval} USD*.\n\nPara mantener tu cuenta al día, pasa por taquilla o coordina tu abono. ¡Gracias!",
  },
  {
    id: "bienvenida",
    label: "Bienvenida",
    grupo: "envio",
    variables: "{nombre} {saldo}",
    txt: "¡Hola {nombre}! 🎉\n\nBienvenido(a) al *Club del Dinero*.\nTu cuenta queda activa con un saldo de *$ {saldo} USD*.\n\n¡Éxitos y buenas jugadas! 🏇",
  },
  {
    id: "negativo",
    label: "Saldo pendiente por abonar",
    grupo: "envio",
    variables: "{nombre} {saldo} {club}",
    txt: "Hola {nombre} 🙏\n\n*{club}*\n\nTu cuenta presenta un saldo pendiente de *$ {saldo} USD*.\nTe pedimos abonar para continuar disfrutando del servicio.\n\n¡Gracias!",
  },
  {
    id: "personalizada",
    label: "Mensaje personalizado",
    grupo: "envio",
    variables: "{nombre}",
    txt: "Hola {nombre} 👋\n\n",
  },
  {
    id: "reporte_general",
    label: "Reporte de saldos",
    grupo: "reporte",
    variables: "{fecha} {club} {lineas} {balance}",
    txt: "📊 *REPORTE DE SALDOS - {club}*\n📅 Fecha: {fecha}\n\n{lineas}💰 *BALANCE GLOBAL (A favor de los clientes):* $ {balance}",
  },
];

/** Fecha legible es-VE (dd/mm/aaaa). */
export function fechaHoy(): string {
  return new Date().toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Número con 2 decimales estilo es-VE (1.234,56) — mismo formato del legacy. */
export function fmtUSD(n: number | string | null | undefined): string {
  const num = Number(n);
  return (Number.isFinite(num) ? num : 0).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Solo dígitos (limpia espacios, guiones, paréntesis y +). */
export function limpiarNumero(tel: string | null | undefined): string {
  return String(tel ?? "").replace(/\D/g, "");
}

/** Separa un teléfono guardado en "código país + número" (ej. "+58 4121234567"). */
export function desglosarTelefono(tel: string | null | undefined): { codigo: string; numero: string } {
  const s = String(tel ?? "").trim().replace(/\s+/g, " ");
  const m = /^(\+\d{1,4}|00\d{1,4}|540)/.exec(s);
  if (m) {
    const resto = s.slice(m[0].length).replace(/\D/g, "");
    return { codigo: (m[0].startsWith("00") ? "+" : m[0] === "540" ? "+54" : m[0]), numero: resto };
  }
  return { codigo: "+58", numero: limpiarNumero(s) };
}

/** Combina país + número en el formato que guarda la BD (mixto, ej. "+58 4121234567"). */
export function componerTelefono(codigo: string, numero: string): string {
  return `${limpiarNumero(codigo) ? limpiarNumero(codigo) : ""} ${limpiarNumero(numero)}`.trim();
}

/** Número completo en formato internacional para wa.me (solo dígitos). */
export function telefonoInt(codigo: string, numero: string): string {
  return limpiarNumero(codigo) + limpiarNumero(numero);
}

/** Enlace wa.me con mensaje codificado. target="_blank" en el caller. */
export function waLink(numero: string, mensaje: string): string {
  return `https://wa.me/${limpiarNumero(numero)}?text=${encodeURIComponent(mensaje)}`;
}

export const CODIGOS_PAIS: string[] = ["+54", "+56", "+57", "+58", "+591", "+594", "+595", "+598"];

// ============================================================
// PLANTILLAS (localStorage + compat legacy)
// ============================================================
let cachePlantillas: PlantillaWsp[] | null = null;

/** Carga plantillas: primero la clave propia, luego el heredado del legacy. */
export function cargarPlantillas(): PlantillaWsp[] {
  if (cachePlantillas) return cachePlantillas;
  let propias: Record<string, string> = {};
  let legacyMsj: Record<string, { txt?: string }> = {};
  try {
    propias = JSON.parse(localStorage.getItem(CLAVE_PLANTILLAS) || "{}");
  } catch {
    propias = {};
  }
  try {
    legacyMsj = JSON.parse(localStorage.getItem(CLAVE_MSJ_LEGACY) || "{}");
  } catch {
    legacyMsj = {};
  }
  const lista = PLANTILLAS_DEFAULT.map((p) => {
    let txt = p.txt;
    const propia = typeof propias[p.id] === "string" ? propias[p.id] : "";
    if (propia.trim() !== "") {
      txt = propia;
    } else {
      const leg = legacyMsj[p.id];
      if (leg && typeof leg.txt === "string" && leg.txt.trim() !== "") txt = leg.txt;
    }
    return { ...p, txt };
  });
  cachePlantillas = lista;
  return lista;
}

export function guardarPlantillas(lista: PlantillaWsp[]): void {
  const pers: Record<string, string> = {};
  lista.forEach((p) => {
    pers[p.id] = p.txt;
  });
  try {
    localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(pers));
  } catch {
    /* sinop */
  }
  cachePlantillas = lista;
}

export function restaurarPlantillas(): PlantillaWsp[] {
  const lista = PLANTILLAS_DEFAULT.map((p) => ({ ...p }));
  guardarPlantillas(lista);
  return lista;
}

export function reemplazarVars(txt: string, c: ClienteWsp | null): string {
  return txt
    .replace(/\{nombre\}/g, c?.nombre ? String(c.nombre) : "—")
    .replace(/\{saldo\}/g, fmtUSD(c?.saldo_actual))
    .replace(/\{aval\}/g, fmtUSD(c?.aval))
    .replace(/\{fecha\}/g, fechaHoy())
    .replace(/\{club\}/g, CLUB_NOMBRE);
}

// ============================================================
// SUPABASE — clientes, teléfonos, notificaciones (historial)
// ============================================================
let cacheClientes: ClienteWsp[] | null = null;

export async function listarClientesWsp(): Promise<ClienteWsp[]> {
  if (cacheClientes) return cacheClientes;
  let lista: ClienteWsp[] = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nombre, saldo_actual, aval, telefono, codigo_pais")
        .order("nombre");
      if (error) throw error;
      lista = (data ?? []).map((c) => ({
        id: String(c.id),
        nombre: String(c.nombre ?? ""),
        saldo_actual: c.saldo_actual != null ? Number(c.saldo_actual) : 0,
        aval: c.aval != null ? Number(c.aval) : 0,
        telefono: c.telefono ? String(c.telefono) : null,
        codigo_pais: c.codigo_pais ? String(c.codigo_pais) : null,
      }));
    } catch {
      lista = [];
    }
  }
  cacheClientes = lista;
  return lista;
}

export async function guardarTelefonoCliente(
  id: string | number,
  telefono: string,
  codigo: string
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("clientes")
      .update({ telefono: componerTelefono(codigo, telefono), codigo_pais: codigo })
      .eq("id", id);
    if (error) {
      console.warn("No se guardó el teléfono:", error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function contarEnviosWsp(): Promise<number> {
  if (!supabase) return 0;
  try {
    const { count } = await supabase.from("notificaciones").select("id", { count: "exact", head: true }).eq("tipo", "whatsapp");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listarHistorialWsp(limite = 50): Promise<RegistroWsp[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("*")
      .eq("tipo", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []) as RegistroWsp[];
  } catch {
    return [];
  }
}

export async function registrarEnvioWsp(args: {
  tipo: string;
  telefono: string;
  mensaje: string;
  cliente: ClienteWsp | null;
}): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("notificaciones").insert([
      {
        tipo: "whatsapp",
        titulo: `WhatsApp · ${args.tipo}`,
        mensaje: args.mensaje,
        cliente_id: args.cliente ? String(args.cliente.id) : null,
        cliente_nombre: args.cliente ? args.cliente.nombre : "GENERAL",
        datos: { telefono: args.telefono, tipo: args.tipo },
        estado: "Enviado",
      },
    ]);
    if (error) console.warn("No se registró el envío:", error.message);
  } catch {
    /* sinop */
  }
}