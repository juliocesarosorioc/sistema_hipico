import { supabase } from "@/core/supabase";

export interface SalaChat {
  id: string;
  grupo_id: string;
  nombre: string;
  descripcion?: string;
  hipodromo?: string | null;
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
      id: `${grupoId}_rinconada`,
      grupo_id: String(grupoId),
      nombre: `La Rinconada${etiquetaGrupo}`,
      descripcion: "Chat exclusivo de carreras de La Rinconada",
      hipodromo: "LA RINCONADA",
      es_principal: true,
      activo: true,
      orden: 1,
      created_at: new Date().toISOString(),
    },
    {
      id: `${grupoId}_americanas`,
      grupo_id: String(grupoId),
      nombre: `Americanas${etiquetaGrupo}`,
      descripcion: "Chat exclusivo de carreras Americanas (USA)",
      hipodromo: "AMERICANAS",
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


/**
 * Edita el nombre y descripción de una sala existente.
 */
export async function editarSala(
  salaId: string,
  grupoId: string,
  nuevoNombre: string,
  nuevaDescripcion?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!salaId || !grupoId) return { ok: false, error: "Datos de sala inválidos." };
  const nomLimpio = nuevoNombre.trim();
  if (!nomLimpio) return { ok: false, error: "El nombre no puede estar vacío." };

  // 1. Supabase
  if (supabase) {
    try {
      await supabase
        .from("chat_salas")
        .update({
          nombre: nomLimpio,
          descripcion: nuevaDescripcion?.trim() || "Sala oficial de jugadas",
        })
        .eq("id", salaId);
    } catch {
      /* ignore */
    }
  }

  // 2. Local
  const actuales = getLocalSalas(grupoId);
  const editadas = actuales.map((s) =>
    s.id === salaId
      ? { ...s, nombre: nomLimpio, descripcion: nuevaDescripcion?.trim() || s.descripcion }
      : s
  );
  setLocalSalas(grupoId, editadas);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hipico:salas-actualizadas", { detail: { grupoId } }));
  }

  return { ok: true };
}

/**
 * Elimina una sala del grupo.
 */
export async function eliminarSala(
  salaId: string,
  grupoId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!salaId || !grupoId) return { ok: false, error: "Datos de sala inválidos." };

  // 1. Supabase
  if (supabase) {
    try {
      await supabase
        .from("chat_salas")
        .delete()
        .eq("id", salaId);
    } catch {
      /* ignore */
    }
  }

  // 2. Local
  const actuales = getLocalSalas(grupoId);
  const filtradas = actuales.filter((s) => s.id !== salaId);
  setLocalSalas(grupoId, filtradas);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hipico:salas-actualizadas", { detail: { grupoId } }));
  }

  return { ok: true };
}

/**
 * Edita el nombre de un Grupo de Venta.
 */
export async function editarGrupoVenta(
  grupoId: string,
  nuevoNombre: string
): Promise<{ ok: boolean; error?: string }> {
  if (!grupoId) return { ok: false, error: "ID de grupo inválido." };
  const nom = nuevoNombre.trim().toUpperCase();
  if (!nom) return { ok: false, error: "El nombre no puede estar vacío." };

  if (supabase) {
    try {
      await supabase
        .from("grupos_venta")
        .update({ nombre: nom })
        .eq("id", grupoId);
    } catch (e: any) {
      console.warn("Error al actualizar grupo:", e?.message);
    }
  }

  return { ok: true };
}

/**
 * Elimina o desactiva un Grupo de Venta.
 */
export async function eliminarGrupoVenta(
  grupoId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!grupoId) return { ok: false, error: "ID de grupo inválido." };

  if (supabase) {
    try {
      await supabase
        .from("grupos_venta")
        .update({ activo: false })
        .eq("id", grupoId);

      await supabase
        .from("chat_salas")
        .update({ activo: false })
        .eq("grupo_id", grupoId);
    } catch {
      /* ignore */
    }
  }

  return { ok: true };
}
