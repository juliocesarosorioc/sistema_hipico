"use client";

import { supabase } from "@/core/supabase";

export type ModalidadPortal =
  | "tablas_fijas"
  | "marcas"
  | "puestos"
  | "remates"
  | "dupletas"
  | "pollas";

export type ConfigActivasPortal = {
  // Claves desactivadas explícitamente por el administrador
  // Si una clave está aquí, el usuario NO puede verla en su portal
  desactivadas: {
    tablas_fijas: string[]; // IDs de tablas_fijas (ej. "12", "15")
    marcas: string[];       // Claves "HIPODROMO|CARRERA|FECHA"
    puestos: string[];      // Claves "HIPODROMO|CARRERA|FECHA"
    remates: string[];      // IDs de remates (ej. "1", "2")
    dupletas: string[];     // Claves "HIPODROMO|FECHA|C1|C2"
    pollas: string[];       // IDs de pollas
  };
  // Modalidades pausadas por completo (toggle global de la modalidad)
  modalidades_pausadas: Record<ModalidadPortal, boolean>;
  updated_at: string;
};

const STORAGE_KEY = "sistema_hipico.config_activas_portal.v2";

export const CONFIG_ACTIVAS_DEFECTO: ConfigActivasPortal = {
  desactivadas: {
    tablas_fijas: [],
    marcas: [],
    puestos: [],
    remates: [],
    dupletas: [],
    pollas: [],
  },
  modalidades_pausadas: {
    tablas_fijas: false,
    marcas: false,
    puestos: false,
    remates: false,
    dupletas: false,
    pollas: false,
  },
  updated_at: new Date().toISOString(),
};

/** Clave normalizada para carreras (Marcas / Puestos) */
export function claveCarreraPortal(hipodromo: string, carrera: number | string, fecha?: string): string {
  const h = String(hipodromo ?? "").trim().toUpperCase();
  const c = String(carrera ?? "").trim();
  const f = String(fecha ?? "").trim();
  return f ? `${h}|${c}|${f}` : `${h}|${c}`;
}

/** Clave normalizada para Dupletas */
export function claveDupletaPortal(hipodromo: string, fecha: string, c1: number | string, c2: number | string): string {
  const h = String(hipodromo ?? "").trim().toUpperCase();
  return `${h}|${fecha ?? ""}|${c1}|${c2}`;
}

function normalizarConfig(raw: unknown): ConfigActivasPortal {
  if (!raw || typeof raw !== "object") return { ...CONFIG_ACTIVAS_DEFECTO };
  const obj = raw as Record<string, unknown>;
  const des = (obj.desactivadas ?? {}) as Record<string, unknown>;
  const pau = (obj.modalidades_pausadas ?? {}) as Record<string, unknown>;

  return {
    desactivadas: {
      tablas_fijas: Array.isArray(des.tablas_fijas) ? des.tablas_fijas.map(String) : [],
      marcas: Array.isArray(des.marcas) ? des.marcas.map(String) : [],
      puestos: Array.isArray(des.puestos) ? des.puestos.map(String) : [],
      remates: Array.isArray(des.remates) ? des.remates.map(String) : [],
      dupletas: Array.isArray(des.dupletas) ? des.dupletas.map(String) : [],
      pollas: Array.isArray(des.pollas) ? des.pollas.map(String) : [],
    },
    modalidades_pausadas: {
      tablas_fijas: Boolean(pau.tablas_fijas),
      marcas: Boolean(pau.marcas),
      puestos: Boolean(pau.puestos),
      remates: Boolean(pau.remates),
      dupletas: Boolean(pau.dupletas),
      pollas: Boolean(pau.pollas),
    },
    updated_at: typeof obj.updated_at === "string" ? obj.updated_at : new Date().toISOString(),
  };
}

export function leerConfigActivasCache(): ConfigActivasPortal {
  if (typeof window === "undefined") return { ...CONFIG_ACTIVAS_DEFECTO };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...CONFIG_ACTIVAS_DEFECTO };
    return normalizarConfig(JSON.parse(raw));
  } catch {
    return { ...CONFIG_ACTIVAS_DEFECTO };
  }
}

function guardarConfigActivasCache(cfg: ConfigActivasPortal, notificar = true): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    if (notificar) {
      window.dispatchEvent(new CustomEvent("config-activas-portal-cambio", { detail: cfg }));
    }
  } catch {
    // ignore
  }
}

/**
 * Lee la configuración de carreras y modalidades activas desde Supabase
 * con respaldo en localStorage.
 */
export async function leerConfigActivasPortal(): Promise<ConfigActivasPortal> {
  const local = leerConfigActivasCache();
  if (!supabase) return local;

  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("datos, created_at")
      .eq("tipo", "config_carreras_activas_portal")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0 && data[0]?.datos) {
      const remoto = normalizarConfig(data[0].datos);
      guardarConfigActivasCache(remoto, false);
      return remoto;
    }
  } catch {
    // fallback a cache
  }

  return local;
}

/**
 * Guarda la configuración de carreras activas en Supabase y notifica a la UI.
 */
export async function guardarConfigActivasPortal(
  nuevaConfig: ConfigActivasPortal
): Promise<{ ok: boolean; error?: string }> {
  const normalizada = normalizarConfig(nuevaConfig);
  normalizada.updated_at = new Date().toISOString();
  guardarConfigActivasCache(normalizada);

  if (!supabase) return { ok: true };

  try {
    await supabase
      .from("notificaciones")
      .delete()
      .eq("tipo", "config_carreras_activas_portal")
      .then(() => undefined, () => undefined);

    const { error } = await supabase.from("notificaciones").insert([
      {
        tipo: "config_carreras_activas_portal",
        titulo: "Configuración de Carreras Activas para el Portal de Usuarios",
        mensaje: "Actualización de carreras y jugadas activas para visualización y venta a clientes.",
        cliente_nombre: "ADMINISTRADOR",
        datos: normalizada,
        estado: "Atendida",
      },
    ]);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ============================================================================
   CONSULTAS DE VISIBILIDAD POR MODALIDAD / ELEMENTO
   ============================================================================ */

/** Verifica si una Tabla Fija está activa para la venta en el portal */
export function esTablaActivaEnPortal(tablaId: string | number, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.tablas_fijas) return false;
  return !config.desactivadas.tablas_fijas.includes(String(tablaId));
}

/** Alterna la visibilidad de una Tabla Fija en el portal */
export async function alternarTablaActivaPortal(tablaId: string | number): Promise<boolean> {
  const idStr = String(tablaId);
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.tablas_fijas;
  const estaDesactivada = list.includes(idStr);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== idStr) : [...list, idStr];
  config.desactivadas.tablas_fijas = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada; // devuelve true si ahora está activa
}

/** Verifica si una carrera de Marcas está activa para la venta en el portal */
export function esMarcaActivaEnPortal(hipodromo: string, carrera: number | string, fecha?: string, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.marcas) return false;
  const k1 = claveCarreraPortal(hipodromo, carrera, fecha);
  const k2 = claveCarreraPortal(hipodromo, carrera);
  return !config.desactivadas.marcas.includes(k1) && !config.desactivadas.marcas.includes(k2);
}

/** Alterna la visibilidad de una carrera de Marcas en el portal */
export async function alternarMarcaActivaPortal(hipodromo: string, carrera: number | string, fecha?: string): Promise<boolean> {
  const clave = claveCarreraPortal(hipodromo, carrera, fecha);
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.marcas;
  const estaDesactivada = list.includes(clave);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== clave) : [...list, clave];
  config.desactivadas.marcas = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada;
}

/** Verifica si una carrera de Puestos está activa en el portal */
export function esPuestoActivoEnPortal(hipodromo: string, carrera: number | string, fecha?: string, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.puestos) return false;
  const k1 = claveCarreraPortal(hipodromo, carrera, fecha);
  const k2 = claveCarreraPortal(hipodromo, carrera);
  return !config.desactivadas.puestos.includes(k1) && !config.desactivadas.puestos.includes(k2);
}

/** Alterna la visibilidad de una carrera de Puestos en el portal */
export async function alternarPuestoActivoPortal(hipodromo: string, carrera: number | string, fecha?: string): Promise<boolean> {
  const clave = claveCarreraPortal(hipodromo, carrera, fecha);
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.puestos;
  const estaDesactivada = list.includes(clave);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== clave) : [...list, clave];
  config.desactivadas.puestos = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada;
}

/** Verifica si un Remate está activo en el portal */
export function esRemateActivoEnPortal(remateId: string | number, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.remates) return false;
  return !config.desactivadas.remates.includes(String(remateId));
}

/** Alterna la visibilidad de un Remate en el portal */
export async function alternarRemateActivoPortal(remateId: string | number): Promise<boolean> {
  const idStr = String(remateId);
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.remates;
  const estaDesactivada = list.includes(idStr);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== idStr) : [...list, idStr];
  config.desactivadas.remates = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada;
}

/** Verifica si una Dupleta está activa en el portal */
export function esDupletaActivaEnPortal(clave: string, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.dupletas) return false;
  return !config.desactivadas.dupletas.includes(clave);
}

/** Alterna la visibilidad de una Dupleta en el portal */
export async function alternarDupletaActivaPortal(clave: string): Promise<boolean> {
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.dupletas;
  const estaDesactivada = list.includes(clave);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== clave) : [...list, clave];
  config.desactivadas.dupletas = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada;
}

/** Verifica si una Polla está activa en el portal */
export function esPollaActivaEnPortal(pollaId: string | number, cfg?: ConfigActivasPortal): boolean {
  const config = cfg ?? leerConfigActivasCache();
  if (config.modalidades_pausadas.pollas) return false;
  return !config.desactivadas.pollas.includes(String(pollaId));
}

/** Alterna la visibilidad de una Polla en el portal */
export async function alternarPollaActivaPortal(pollaId: string | number): Promise<boolean> {
  const idStr = String(pollaId);
  const config = await leerConfigActivasPortal();
  const list = config.desactivadas.pollas;
  const estaDesactivada = list.includes(idStr);

  const nuevaLista = estaDesactivada ? list.filter((x) => x !== idStr) : [...list, idStr];
  config.desactivadas.pollas = nuevaLista;

  await guardarConfigActivasPortal(config);
  return estaDesactivada;
}

/** Alterna la pausa global de toda una modalidad para el portal */
export async function alternarPausaModalidadPortal(modalidad: ModalidadPortal): Promise<boolean> {
  const config = await leerConfigActivasPortal();
  const actual = Boolean(config.modalidades_pausadas[modalidad]);
  config.modalidades_pausadas[modalidad] = !actual;

  await guardarConfigActivasPortal(config);
  return !actual; // devuelve true si quedó pausada
}
