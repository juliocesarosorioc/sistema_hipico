/**
 * Centro WhatsApp — utilidades, plantillas dinámicas (localStorage) y conexión
 * a Supabase (clientes, notificaciones). Clon del legacy js/whatsapp.js:
 *  - Plantillas editables con reemplazo de {nombre} {saldo} {aval} {fecha} {club}
 *  - Persistencia local + compat con la clave del legacy (club_mensajes_whatsapp)
 *  - Números limpios para wa.me (sin espacios ni +).
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";

export const CLUB_NOMBRE = "Club del Dinero";

export type PlantillaWsp = {
  id: string;
  label: string;
  /**
 * Grupo de la plantilla: "envio" (selector individual), "reporte", "tablas"
 * (pizarras de tablas/remates), "marcas" o "dupleta".
 */
  grupo: "envio" | "reporte" | "tablas" | "marcas" | "dupleta";
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

const CLAVE_PLANTILLAS = "sistema-hipico:whatsapp-plantillas-v2";
const CLAVE_PLANTILLAS_V1 = "sistema-hipico:whatsapp-plantillas";
/** Compat: el legacy guardaba en esta clave (grupo "Plantillas del Centro WhatsApp"). */
const CLAVE_MSJ_LEGACY = "club_mensajes_whatsapp";

export const VARIABLES_WSP = [
  "{nombre}",
  "{saldo}",
  "{aval}",
  "{disponible}",
  "{fecha}",
  "{club}",
  "{lineas}",
  "{balance}",
  "{totales}",
  "{hipodromos}",
  "{remate}",
  "{hipodromo}",
  "{carrera}",
];

export const PLANTILLAS_DEFAULT: PlantillaWsp[] = [
  {
    id: "saldo",
    label: "Saldo actual",
    grupo: "envio",
    variables: "{nombre} {saldo} {aval} {disponible} {club}",
    txt: "👋 *¡Hola, {nombre}!* 🏇\n\n🏆 *{club}*\n----------------------------------------\n📊 *ESTADO DE CUENTA:*\n\n💰 *Saldo Actual:* $ {saldo} USD\n🛡️ *Aval Vigente:* $ {aval} USD\n⚡ *Disponible para Jugar:* *$ {disponible} USD*\n----------------------------------------\n✨ _¡Gracias por tu confianza y mucha suerte en tus jugadas!_ 🍀🏇",
  },
  {
    id: "aval",
    label: "Recordatorio de aval",
    grupo: "envio",
    variables: "{nombre} {aval} {club}",
    txt: "⚠️ *RECORDATORIO DE AVAL* ⚠️\n\n👤 *Estimado(a) {nombre}:*\n🏇 *{club}*\n----------------------------------------\n\n📌 Te recordamos que mantienes un aval pendiente por:\n🛡️ *Monto Aval:* *$ {aval} USD*\n\n💳 Para mantener tu cuenta activa y al día, por favor coordina tu abono o acércate a taquilla.\n----------------------------------------\n🤝 _¡Agradecemos tu puntualidad y preferencia!_",
  },
  {
    id: "bienvenida",
    label: "Bienvenida",
    grupo: "envio",
    variables: "{nombre} {saldo}",
    txt: "🎉 *¡BIENVENIDO(A) A {club}!* 🏇\n\n👋 *Hola, {nombre}:*\nTu cuenta ha sido activada con éxito en nuestro sistema.\n\n💳 *Saldo Inicial:* 💰 *$ {saldo} USD*\n⚡ *Estado:* 🟢 Cuenta 100% Operativa\n\n----------------------------------------\n🏇 _¡Te deseamos el mayor de los éxitos en cada carrera y excelentes jugadas!_ 🍀🔥",
  },
  {
    id: "negativo",
    label: "Saldo pendiente por abonar",
    grupo: "envio",
    variables: "{nombre} {saldo} {club}",
    txt: "🔔 *AVISO DE SALDO PENDIENTE* 🔔\n\n👤 *Hola, {nombre}:*\n🏇 *{club}*\n----------------------------------------\n\n📉 Tu cuenta presenta un saldo pendiente por liquidar:\n🔴 *Saldo por Abonar:* *$ {saldo} USD*\n\n💳 Te solicitamos gestionar tu abono para reactivar tu cupo y seguir disfrutando del juego sin interrupciones.\n----------------------------------------\n🙏 _¡Muchas gracias por tu atención y pronta gestión!_",
  },
  {
    id: "personalizada",
    label: "Mensaje personalizado",
    grupo: "envio",
    variables: "{nombre}",
    txt: "👋 *Hola, {nombre}:*\n🏇 *{club}*\n----------------------------------------\n\n",
  },
  {
    id: "reporte_general",
    label: "Reporte de saldos",
    grupo: "reporte",
    variables: "{fecha} {club} {lineas} {balance}",
    txt: "📊 *REPORTE CONSOLIDADO DE SALDOS* 📊\n🏇 *{club}*\n📅 *Fecha:* {fecha}\n----------------------------------------\n\n{lineas}\n----------------------------------------\n💰 *BALANCE GLOBAL (A favor de los clientes):* *$ {balance} USD*\n📌 _Reporte oficial generado por sistema._",
  },
  {
    id: "tablas_matriz",
    label: "Tablas Fijas (matriz)",
    grupo: "tablas",
    variables: "{fecha} {lineas} {totales}",
    txt: "🏇🏆 *TABLAS FIJAS PUBLICADAS* 🏆🏇\n📅 *Jornada:* {fecha}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n🧮 *Total Ejemplares:* *{totales}*\n📌 *Normas:* Válida exclusivamente para la carrera y el ejemplar indicados. Presentar ticket en taquilla.",
  },
  {
    id: "tablas_reporte",
    label: "Reporte de Tablas",
    grupo: "tablas",
    variables: "{fecha} {lineas}",
    txt: "📊📋 *REPORTE DE CONTROL — TABLAS FIJAS* 📋📊\n📅 *Fecha:* {fecha}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n🔒 *Control Interno:* Reporte de auditoría y conciliación de tablas fijas.",
  },
  {
    id: "remates_pizarra",
    label: "Pizarra de Remates",
    grupo: "tablas",
    variables: "{remate} {hipodromo} {carrera} {fecha} {lineas} {incentivo} {total}",
    txt: "🔨🏇 *PIZARRA OFICIAL DE REMATES* 🏇🔨\n🏛️ *{hipodromo}* · Carrera {carrera}\n📅 *Fecha:* {fecha}\n🏷️ *{remate}*\n----------------------------------------\n\n{lineas}\n\n🎁 *Incentivo de la casa:*  {incentivo}\n\n----------------------------------------\n💰 *TOTAL A PAGAR:* *{total}*\n🏁 _Pizarra oficial certificada para pago en taquilla._",
  },
  {
    id: "marcas_resultados",
    label: "Marcas de la|Programa",
    grupo: "marcas",
    variables: "{nombre} {club} {fecha} {hipodromo} {carrera} {lineas} {premio}",
    txt: "🎯🏇 *MARCAS OFICIALES — RESULTADOS* 🏇🎯\n👋 *Hola, {nombre}:*\n🏛️ *{club}*\n📅 *Fecha:* {fecha} · 📍 *Hipódromo:* {hipodromo} · 🏁 *Carrera:* C{carrera}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n💰 *Premio de la carrera:* *$ {premio} USD*\n📌 _Válido bajo las reglas oficiales de marcas del club. Juega con criterio._",
  },
  {
    id: "marcas_duplicados",
    label: "Marcas repetidas",
    grupo: "marcas",
    variables: "{nombre} {club} {fecha} {lineas}",
    txt: "⚠️📋 *ALERTA DE MARCAS REPETIDAS* 📋⚠️\n👤 *Estimado(a) {nombre}:*\n🏇 *{club}* · 📅 {fecha}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n🔍 *Atención:* Por favor revisa y valida tu ticket antes de solicitar cobro en taquilla.",
  },
  {
    id: "marcas_hoja",
    label: "Hoja de Marcas del día",
    grupo: "marcas",
    variables: "{fecha} {hipodromo} {lineas} {totales} {marcas}",
    txt: "🏇📋 *PROGRAMA Y HOJA DE MARCAS DEL DÍA* 📋🏇\n📅 *Fecha Oficial:* {fecha}\n🏛️ *Hipódromo:* {hipodromo}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n🧮 *Total Carreras:* *{totales}* · 🎯 *Con Jugadas:* *{marcas}*\n📌 _Válidas únicamente para el día indicado. Presentar en taquilla._",
  },
  {
    id: "dupleta_pizarra",
    label: "Pizarra de Dupleta",
    grupo: "dupleta",
    variables: "{club} {fecha} {hipodromo} {lineas} {premio}",
    txt: "🎰🏇 *PIZARRA OFICIAL DE DUPLETA* 🏇🎰\n🏆 *{club}*\n📅 *Fecha:* {fecha} · 🏛️ *Hipódromo:* {hipodromo}\n----------------------------------------\n\n{lineas}\n\n----------------------------------------\n💰 *PREMIO ACUMULADO:* *$ {premio} USD*\n📌 _Válida exclusivamente para la jornada indicada. Presentar en taquilla._",
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

/** Carga plantillas: primero la clave propia v2, luego migración de v1 y compat legacy. */
export function cargarPlantillas(): PlantillaWsp[] {
  if (cachePlantillas) return cachePlantillas;
  let propias: Record<string, string> = {};
  let legacyMsj: Record<string, { txt?: string }> = {};
  try {
    const rawV2 = localStorage.getItem(CLAVE_PLANTILLAS);
    if (rawV2) {
      propias = JSON.parse(rawV2);
    } else {
      // Migración selectiva: solo conservar plantillas personalizadas de v1
      const rawV1 = localStorage.getItem(CLAVE_PLANTILLAS_V1);
      if (rawV1) {
        const v1 = JSON.parse(rawV1);
        for (const k of Object.keys(v1)) {
          if (!PLANTILLAS_DEFAULT.some((d) => d.id === k)) {
            propias[k] = v1[k];
          }
        }
      }
    }
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
    // Auto-sanitizar caracteres multibyte propensos a corromperse en WhatsApp (rombo con interrogación)
    txt = txt.replace(/━+/g, "----------------------------------------");
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
  /* `{disponible}` = saldo + aval: lo que el cliente REALMENTE puede jugar.
     Sin esta variable el mensaje de un cliente en mora dice "saldo -$300" y
     el cliente cree que no puede jugar, cuando en realidad tiene su aval. */
  const disponible = (c?.saldo_actual ?? 0) + (c?.aval ?? 0);
  return txt
    .replace(/\{nombre\}/g, c?.nombre ? String(c.nombre) : "—")
    .replace(/\{saldo\}/g, fmtUSD(c?.saldo_actual))
    .replace(/\{aval\}/g, fmtUSD(c?.aval))
    .replace(/\{disponible\}/g, fmtUSD(disponible))
    .replace(/\{fecha\}/g, fechaHoy())
    .replace(/\{club\}/g, CLUB_NOMBRE);
}

/** Reemplazo genérico de variables para plantillas de TABLAS (matriz/reporte). */
export function reemplazarVarsTablas(txt: string, vars: Record<string, string>): string {
  return txt.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? vars[k] : `{${k}}`
  );
}

/** Texto de una plantilla por id (con preferencia a la persistida por el usuario). */
export function plantillaPorId(id: string): string {
  const p = cargarPlantillas().find((x) => x.id === id);
  return p?.txt ?? "";
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

// ============================================================
// CONEXIÓN AL GRUPO — WhatsApp Business Cloud API
// (Edge Functions: whatsapp-webhook / whatsapp-grupos / whatsapp-enviar)
// ============================================================
export type GrupoWsp = {
  group_id: string;
  nombre: string | null;
  phone_number_id: string | null;
  vinculado: boolean;
  primera_deteccion?: string;
  ultimo_evento?: string;
  created_at?: string;
};

export type AutomatizacionWsp = {
  modulo: string;
  activo: boolean;
  updated_at?: string;
};

export type EstadoWhatsappApi = {
  configurado: boolean;
  webhook: boolean;
};

export type ResWhatsappFn = {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
};

/**
 * Guardia local del módulo WhatsApp. La Edge Function vuelve a comprobar la
 * capacidad del lado del servidor (con `tiene_capacidad`), pero acá evitamos que
 * un usuario sin permiso reciba el rebote recién al final del viaje de red.
 * Devuelve un error listo para la UI, o null si puede pasar.
 */
function sinPermisoWsp(clave: "whatsapp:vincular_grupo" | "whatsapp:enviar_grupo"): ResWhatsappFn | null {
  try {
    exigirCapacidad(clave);
    return null;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sin permiso para operar el grupo de WhatsApp." };
  }
}

const URL_FN =
  process.env.NEXT_PUBLIC_WHATSAPP_CLOUD_ENABLED === "true" && process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`
    : "";

let wspFnNoDisponible = false;

/**
 * Llama a una Edge Function de WhatsApp con la sesión del usuario. La función
 * valida el JWT contra Supabase Auth y la RPC `tiene_capacidad`; sin sesión de
 * staff la llamada se rechaza del lado del servidor. Devuelve null si no hay
 * sesión, no hay red o la respuesta no fue JSON.
 */
async function llamarWhatsappFn(nombre: string, body: Record<string, unknown>): Promise<ResWhatsappFn | null> {
  if (!supabase || !URL_FN || wspFnNoDisponible) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    let resp: Response;
    try {
      resp = await fetch(`${URL_FN}/${nombre}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      wspFnNoDisponible = true;
      return null;
    }
    const txt = await resp.text();
    let datos: ResWhatsappFn;
    try {
      datos = JSON.parse(txt);
    } catch {
      datos = { ok: false, error: `Respuesta inesperada (${resp.status}).` };
    }
    if (!resp.ok && !datos.error) datos.error = `Error ${resp.status}.`;
    return datos;
  } catch {
    return null;
  }
}

/** ¿La integración está configurada (token + Phone Number ID)? null = sin red. */
export async function estadoWhatsappApi(): Promise<EstadoWhatsappApi | null> {
  const res = await llamarWhatsappFn("whatsapp-grupos", { accion: "estado" });
  if (!res?.ok) return null;
  return {
    configurado: res.configurado === true,
    webhook: res.webhook === true,
  };
}

/** Grupos detectados por el webhook, con el vinculado marcado. */
export async function listarGruposWsp(): Promise<GrupoWsp[]> {
  const res = await llamarWhatsappFn("whatsapp-grupos", { accion: "listar" });
  if (!res?.ok || !Array.isArray(res.grupos)) return [];
  return res.grupos as GrupoWsp[];
}

/** Marca un grupo como destino de los envíos. */
export async function vincularGrupoWsp(groupId: string, nombre?: string): Promise<ResWhatsappFn | null> {
  const falta = sinPermisoWsp("whatsapp:vincular_grupo");
  if (falta) return falta;
  return llamarWhatsappFn("whatsapp-grupos", { accion: "vincular", group_id: groupId, nombre });
}

/** Saca la marca de grupo vinculado. */
export async function desvincularGrupoWsp(): Promise<ResWhatsappFn | null> {
  const falta = sinPermisoWsp("whatsapp:vincular_grupo");
  if (falta) return falta;
  return llamarWhatsappFn("whatsapp-grupos", { accion: "desvincular" });
}

/** Pone un nombre humano al grupo detectado. */
export async function renombrarGrupoWsp(groupId: string, nombre: string): Promise<ResWhatsappFn | null> {
  const falta = sinPermisoWsp("whatsapp:vincular_grupo");
  if (falta) return falta;
  return llamarWhatsappFn("whatsapp-grupos", { accion: "renombrar", group_id: groupId, nombre });
}

/** Toggles de envío automático por módulo. */
export async function leerAutomatizacionesWsp(): Promise<AutomatizacionWsp[]> {
  const res = await llamarWhatsappFn("whatsapp-grupos", { accion: "automatizaciones" });
  if (!res?.ok || !Array.isArray(res.automatizaciones)) return [];
  return res.automatizaciones as AutomatizacionWsp[];
}

/** Activa/desactiva el envío automático de un módulo. */
export async function guardarAutomatizacionWsp(modulo: string, activo: boolean): Promise<ResWhatsappFn | null> {
  return llamarWhatsappFn("whatsapp-grupos", { accion: "automatizacion", modulo, activo });
}

/**
 * Envía un texto al grupo vinculado por la Cloud API. Devuelve la respuesta de
 * la función; null si no hay sesión o no hay red (la UI lo muestra).
 */
export async function enviarAlGrupoWsp(
  mensaje: string,
  modulo = "whatsapp"
): Promise<ResWhatsappFn | null> {
  const falta = sinPermisoWsp("whatsapp:enviar_grupo");
  if (falta) return falta;
  return llamarWhatsappFn("whatsapp-enviar", { accion: "enviar", mensaje, destino: "grupo", modulo });
}

/**
 * Envío automático desde un módulo (remate_cierre, tablas_publicar,
 * marcas_cierre, jornada_cierre): solo dispara si el toggle está activo y hay
 * grupo vinculado. Fallos silenciosos a propósito: el evento principal del
 * módulo no puede quedarse esperando a WhatsApp.
 */
export async function enviarAutomaticoSiActivo(modulo: string, mensaje: string): Promise<void> {
  try {
    const autos = await leerAutomatizacionesWsp();
    if (!autos.some((a) => a.modulo === modulo && a.activo)) return;
    const res = await enviarAlGrupoWsp(mensaje, modulo);
    if (res?.ok) console.info(`[whatsapp-auto] ${modulo}: enviado al grupo vinculado.`);
    else console.warn(`[whatsapp-auto] ${modulo}: ${res?.error ?? "sin respuesta"}`);
  } catch {
    /* sinop */
  }
}