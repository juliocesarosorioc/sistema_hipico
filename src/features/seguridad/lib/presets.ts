/**
 * ============================================================================
 * PRESETS DE ROL — configuración de accesos en 1 clic
 * ============================================================================
 *
 * Un preset es un conjunto curado de capacidades que representa el "paquete de
 * trabajo" de un rol típico del club. No reemplaza a la matriz editable: es el
 * punto de partida para que configurar un tipo de usuario no exija marcar 300
 * casillas a mano.
 *
 * Los presets son SOLO de interfaz: lo que se guarda sigue siendo la lista de
 * capacidades del tipo, expandida con `expandirConRequisitos`. Si un preset
 * queda desactualizado respecto al registro maestro, no rompe nada: al aplicarlo
 * se expanden los requisitos y las claves inexistentes se ignoran.
 *
 * `modulos` usa las claves REALES de `MODULOS_ESQUEMA`. Cualquier capacidad
 * suelta va en `extras`; con `!clave` se RESTA (para que un preset pueda quitar
 * algo que un módulo arrastra).
 */

import { CAPACIDADES } from "@/features/seguridad/lib/capacidades";
import { expandirConRequisitos } from "@/features/seguridad/lib/resolver";

export type PresetRol = {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string;
  /** Módulos del maestro que quedan habilitados (todas sus capacidades). */
  modulos: string[];
  /** Capacidades puntuales fuera de esos módulos (o exclusiones si empieza con "!"). */
  extras?: string[];
  /** Color del borde/acento en la UI. */
  color: string;
};

/**
 * Los cinco roles que pidió el club. Con `modulos: ["*"]` el preset habilita
 * TODO el maestro (solo el SuperAdmin).
 */
export const PRESETS_ROL: PresetRol[] = [
  {
    id: "superadmin",
    nombre: "SuperAdmin",
    descripcion: "Acceso total. Único rol que puede tocar el maestro de seguridad y la auditoría.",
    icono: "👑",
    modulos: ["*"],
    color: "border-amber-400 bg-amber-50",
  },
  {
    id: "admin",
    nombre: "Admin",
    descripcion: "Gestión completa del club: carreras, jugadas, finanzas y reportes. Sin el maestro de seguridad.",
    icono: "🛡️",
    modulos: [
      "general",
      "clientes",
      "grupos",
      "hipodromos",
      "ejemplares",
      "carreras",
      "gestion_jugadas",
      "jugadas",
      "tablas",
      "marcas",
      "dupleta",
      "taquilla",
      "tickets",
      "contabilidad",
      "remates",
      "pollas",
      "reglas_jugadas",
      "whatsapp",
      "operadores",
      "inteligencia_hipica",
    ],
    extras: ["portal:ruta_portal"],
    color: "border-indigo-400 bg-indigo-50",
  },
  {
    id: "dueno_grupo",
    nombre: "Dueño de Grupo / Banquero",
    descripcion: "Administra EXCLUSIVAMENTE su grupo: clientes, saldos, avales, comisiones y límites. Aislado por RLS.",
    icono: "🏦",
    modulos: ["general", "clientes", "grupos", "jugadas", "contabilidad", "tickets"],
    color: "border-emerald-400 bg-emerald-50",
  },
  {
    id: "operador",
    nombre: "Operador / Taquilla",
    descripcion: "Vende jugadas y cobra. No configura, no ve finanzas globales ni el maestro de seguridad.",
    icono: "🎟️",
    modulos: ["general", "taquilla", "tablas", "marcas", "dupleta", "carreras", "jugadas", "ejemplares", "tickets"],
    color: "border-sky-400 bg-sky-50",
  },
  {
    id: "jugador",
    nombre: "Jugador / Cliente",
    descripcion: "Solo el Portal del Cliente: sus jugadas, sus reclamos y su perfil. Cero acceso al panel administrativo.",
    icono: "🐎",
    modulos: [],
    extras: ["portal:ruta_portal"],
    color: "border-slate-400 bg-slate-50",
  },
];

/** Todas las claves del maestro que corresponden a los módulos pedidos. */
function clavesDeModulos(modulos: string[]): string[] {
  const todos = modulos.includes("*");
  const set = new Set<string>();
  for (const cap of CAPACIDADES) {
    if (todos || modulos.includes(cap.modulo)) set.add(cap.clave);
  }
  return [...set];
}

/**
 * Resuelve un preset a la lista de claves ya expandida con requisitos.
 * Las claves en `extras` que empiezan con `!` se RESTAN después de expandir.
 */
export function capacidadesDePreset(preset: PresetRol): string[] {
  const set = new Set(clavesDeModulos(preset.modulos));
  const quitar = new Set<string>();
  for (const extra of preset.extras ?? []) {
    if (extra.startsWith("!")) quitar.add(extra.slice(1));
    else set.add(extra);
  }
  const expandido = new Set(expandirConRequisitos([...set]));
  for (const q of quitar) expandido.delete(q);
  return [...expandido];
}

/** Cantidad de capacidades efectivas de un preset (para mostrar en la tarjeta). */
export function contarPreset(preset: PresetRol): number {
  return capacidadesDePreset(preset).length;
}
