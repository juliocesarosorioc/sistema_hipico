import { supabase } from "@/core/supabase";

export interface SalaChat {
  id: string;
  grupo_id: string;
  nombre: string;
  descripcion?: string;
  es_principal?: boolean;
  activo?: boolean;
  orden?: number;
  created_at?: string;
}

const STORAGE_PREFIX = "hipico_salas_grupo_";
const inMemorySalas = new Map<string, SalaChat[]>();

function getLocalSalas(grupoId: string): SalaChat[] {
  if (typeof window === "undefined") {
    return inMemorySalas.get(grupoId) || [];
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${grupoId}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }
  return inMemorySalas.get(grupoId) || [];
}

function setLocalSalas(grupoId: string, salas: SalaChat[]): void {
  inMemorySalas.set(grupoId, salas);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${grupoId}`, JSON.stringify(salas));
  } catch {
    /* ignore */
  }
}

/** Genera las salas por defecto para cualquier grupo que aún no tenga salas creadas */
export function generarSalasDefaultGrupo(grupoId: string, nombreGrupo?: string): SalaChat[] {
  const etiquetaGrupo = nombreGrupo ? ` · ${nombreGrupo}` : "";
  return [
    {
      id: `${grupoId}_principal`,
      grupo_id: String(grupoId),
      nombre: `Sala Principal${etiquetaGrupo}`,
      descripcion: "Sala oficial P2P de puestos y cruces",
      es_principal: true,
      activo: true,
      orden: 1,
      created_at: new Date().toISOString(),
    },
    {
      id: `${grupoId}_puestos`,
      grupo_id: String(grupoId),
      nombre: `Sala Puestos VIP${etiquetaGrupo}`,
      descripcion: "Exclusivo jugadas directas de puestos",
      es_principal: false,
      activo: true,
      orden: 2,
      created_at: new Date().toISOString(),
    },
  ];
}

/**
 * Lista las salas exclusivas correspondientes a un grupo de venta específico.
 * Cada grupo tiene sus propias salas independientes.
 */
export async function listarSalasPorGrupo(
  grupoId: string,
  nombreGrupo?: string
): Promise<SalaChat[]> {
  if (!grupoId) return [];
  const gId = String(grupoId);

  // 1. Intentar consultar Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("chat_salas")
        .select("*")
        .eq("grupo_id", gId)
        .eq("activo", true)
        .order("orden", { ascending: true })
        .order("created_at", { ascending: true });

      if (!error && data && data.length > 0) {
        setLocalSalas(gId, data);
        return data;
      }
    } catch {
      /* fallback a cache local / defaults */
    }
  }

  // 2. Fallback a almacenamiento local del navegador
  const locales = getLocalSalas(gId);
  if (locales.length > 0) {
    return locales;
  }

  // 3. Si no existen salas registradas para este grupo, sembrar las salas iniciales por defecto
  const defaults = generarSalasDefaultGrupo(gId, nombreGrupo);
  setLocalSalas(gId, defaults);

  // Intentar sincronizar las salas por defecto a Supabase en segundo plano si está disponible
  if (supabase) {
    try {
      await supabase.from("chat_salas").upsert(
        defaults.map((d) => ({
          id: d.id,
          grupo_id: d.grupo_id,
          nombre: d.nombre,
          descripcion: d.descripcion,
          es_principal: d.es_principal,
          activo: d.activo,
          orden: d.orden,
        })),
        { onConflict: "id" }
      );
    } catch {
      /* ignore */
    }
  }

  return defaults;
}

/**
 * Crea una nueva sala asociada estrictamente al grupo indicado.
 */
export async function crearSalaEnGrupo(
  grupoId: string,
  nombre: string,
  descripcion?: string
): Promise<{ ok: boolean; sala?: SalaChat; error?: string }> {
  if (!grupoId) {
    return { ok: false, error: "Se requiere un grupo de venta válido." };
  }
  const gId = String(grupoId);
  const nomLimpio = nombre.trim();
  if (!nomLimpio) {
    return { ok: false, error: "El nombre de la sala no puede estar vacío." };
  }

  // Generar ID único para la sala
  const slug = nomLimpio
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .slice(0, 20);
  const nuevaSalaId = `sala_${gId}_${slug}_${Date.now().toString().slice(-4)}`;

  const nuevaSala: SalaChat = {
    id: nuevaSalaId,
    grupo_id: gId,
    nombre: nomLimpio,
    descripcion: descripcion?.trim() || "Sala oficial de jugadas",
    es_principal: false,
    activo: true,
    orden: 99,
    created_at: new Date().toISOString(),
  };

  // 1. Guardar en Supabase si está disponible
  if (supabase) {
    try {
      const { error } = await supabase.from("chat_salas").insert({
        id: nuevaSala.id,
        grupo_id: nuevaSala.grupo_id,
        nombre: nuevaSala.nombre,
        descripcion: nuevaSala.descripcion,
        es_principal: false,
        activo: true,
        orden: 99,
      });
      if (error) {
        console.warn("Aviso al guardar sala en Supabase (se preserva en local):", error.message);
      }
    } catch (e: any) {
      console.warn("Error de conexión Supabase en crearSalaEnGrupo:", e?.message);
    }
  }

  // 2. Guardar en almacenamiento local del grupo
  const actuales = getLocalSalas(gId);
  const combinadas = [...actuales, nuevaSala];
  setLocalSalas(gId, combinadas);

  // 3. Notificar a componentes reactivos
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hipico:salas-actualizadas", { detail: { grupoId: gId } }));
  }

  return { ok: true, sala: nuevaSala };
}
