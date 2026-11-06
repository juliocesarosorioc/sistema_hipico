/**
 * ============================================================================
 * REPOSITORIO DE GACETAS HÍPICAS Y PROGRAMAS OFICIALES
 * ============================================================================
 * Permite almacenar, organizar y publicar gacetas en PDF/imágenes tanto para el
 * operador de taquilla como para consulta y descarga libre de los jugadores en el portal.
 */

import { supabase } from "@/core/supabase";

export interface GacetaAlmacenada {
  id: string;
  titulo: string;
  hipodromo: string;
  fecha: string; // YYYY-MM-DD
  nombreArchivo: string;
  tamanoBytes: number;
  tipoMime: string;
  urlArchivo: string; // Data URL base64 o URL remota de Supabase Storage / CDN
  publicadaEnPortal: boolean;
  fechaPublicacion: string; // ISO string
  subidoPor?: string;
  descripcion?: string;
}

const STORAGE_KEY = "club_repositorio_gacetas_v1";

/** Obtiene la lista de gacetas cacheadas en el navegador */
function leerCacheLocal(): GacetaAlmacenada[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GacetaAlmacenada[]) : [];
  } catch {
    return [];
  }
}

/** Guarda la lista en cache local */
function guardarCacheLocal(lista: GacetaAlmacenada[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch (e) {
    console.warn("No se pudo persistir cache de gacetas en localStorage:", e);
  }
}

/**
 * Lista todas las gacetas almacenadas.
 * Si `soloPublicadas === true`, devuelve solo las autorizadas para el portal de jugadores.
 */
export async function listarGacetasRepositorio(filtros?: {
  hipodromo?: string;
  fecha?: string;
  soloPublicadas?: boolean;
}): Promise<GacetaAlmacenada[]> {
  let gacetas: GacetaAlmacenada[] = leerCacheLocal();

  // Intentar sincronizar con Supabase si está disponible
  if (supabase) {
    try {
      let query = supabase
        .from("gacetas_archivos")
        .select("*")
        .order("fecha", { ascending: false });

      if (filtros?.soloPublicadas) {
        query = query.eq("publicada_en_portal", true);
      }
      if (filtros?.hipodromo) {
        query = query.ilike("hipodromo", `%${filtros.hipodromo.trim()}%`);
      }
      if (filtros?.fecha) {
        query = query.eq("fecha", filtros.fecha);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        const remotas: GacetaAlmacenada[] = data.map((d: Record<string, unknown>) => ({
          id: String(d.id),
          titulo: String(d.titulo || "Gaceta Oficial"),
          hipodromo: String(d.hipodromo || "HIPÓDROMO").toUpperCase(),
          fecha: String(d.fecha || new Date().toISOString().slice(0, 10)),
          nombreArchivo: String(d.nombre_archivo || "gaceta.pdf"),
          tamanoBytes: Number(d.tamano_bytes) || 0,
          tipoMime: String(d.tipo_mime || "application/pdf"),
          urlArchivo: String(d.url_archivo || ""),
          publicadaEnPortal: Boolean(d.publicada_en_portal),
          fechaPublicacion: String(d.fecha_publicacion || d.created_at || new Date().toISOString()),
          subidoPor: d.subido_por ? String(d.subido_por) : undefined,
          descripcion: d.descripcion ? String(d.descripcion) : undefined,
        }));

        // Fusionar remotas con locales evitando duplicados por ID
        const mapa = new Map<string, GacetaAlmacenada>();
        for (const g of gacetas) mapa.set(g.id, g);
        for (const r of remotas) mapa.set(r.id, r);
        gacetas = Array.from(mapa.values());
        guardarCacheLocal(gacetas);
      }
    } catch {
      /* Fallback transparente a cache local */
    }
  }

  // Filtrar en memoria
  return gacetas
    .filter((g) => {
      if (filtros?.soloPublicadas && !g.publicadaEnPortal) return false;
      if (
        filtros?.hipodromo &&
        filtros.hipodromo.trim() &&
        !g.hipodromo.toUpperCase().includes(filtros.hipodromo.trim().toUpperCase())
      ) {
        return false;
      }
      if (filtros?.fecha && g.fecha !== filtros.fecha) return false;
      return true;
    })
    .sort((a, b) => (b.fecha > a.fecha ? 1 : b.fecha < a.fecha ? -1 : 0));
}

/**
 * Guarda una nueva gaceta en el repositorio (local + Supabase si existe la tabla).
 */
export async function guardarGacetaEnRepositorio(params: {
  titulo: string;
  hipodromo: string;
  fecha: string;
  nombreArchivo: string;
  tamanoBytes: number;
  tipoMime: string;
  urlArchivo: string;
  publicadaEnPortal?: boolean;
  subidoPor?: string;
  descripcion?: string;
}): Promise<{ ok: boolean; gaceta?: GacetaAlmacenada; error?: string }> {
  const nueva: GacetaAlmacenada = {
    id: `gaceta_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    titulo: params.titulo.trim() || `Gaceta Oficial ${params.hipodromo}`,
    hipodromo: params.hipodromo.trim().toUpperCase(),
    fecha: params.fecha.trim(),
    nombreArchivo: params.nombreArchivo,
    tamanoBytes: params.tamanoBytes,
    tipoMime: params.tipoMime,
    urlArchivo: params.urlArchivo,
    publicadaEnPortal: params.publicadaEnPortal ?? true,
    fechaPublicacion: new Date().toISOString(),
    subidoPor: params.subidoPor || "Operador",
    descripcion: params.descripcion?.trim(),
  };

  // 1. Guardar en cache local de inmediato
  const actuales = leerCacheLocal();
  const actualizadas = [nueva, ...actuales.filter((g) => g.id !== nueva.id)];
  guardarCacheLocal(actualizadas);

  // 2. Intentar guardar en Supabase si la tabla existe
  if (supabase) {
    try {
      await supabase.from("gacetas_archivos").insert({
        id: nueva.id,
        titulo: nueva.titulo,
        hipodromo: nueva.hipodromo,
        fecha: nueva.fecha,
        nombre_archivo: nueva.nombreArchivo,
        tamano_bytes: nueva.tamanoBytes,
        tipo_mime: nueva.tipoMime,
        url_archivo: nueva.urlArchivo,
        publicada_en_portal: nueva.publicadaEnPortal,
        fecha_publicacion: nueva.fechaPublicacion,
        subido_por: nueva.subidoPor,
        descripcion: nueva.descripcion,
      });
    } catch {
      /* noop si no existe tabla remota */
    }
  }

  // Notificar por evento a los módulos suscritos
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gaceta:guardada", { detail: nueva }));
  }

  return { ok: true, gaceta: nueva };
}

/**
 * Alterna si la gaceta está publicada en el portal de jugadores o solo visible para el admin.
 */
export async function alternarPublicacionGaceta(
  id: string,
  publicada: boolean
): Promise<{ ok: boolean }> {
  const actuales = leerCacheLocal();
  const modificadas = actuales.map((g) =>
    g.id === id ? { ...g, publicadaEnPortal: publicada } : g
  );
  guardarCacheLocal(modificadas);

  if (supabase) {
    try {
      await supabase
        .from("gacetas_archivos")
        .update({ publicada_en_portal: publicada })
        .eq("id", id);
    } catch {
      /* noop */
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gaceta:actualizada", { detail: { id, publicada } }));
  }

  return { ok: true };
}

/**
 * Elimina una gaceta del repositorio.
 */
export async function eliminarGacetaRepositorio(id: string): Promise<{ ok: boolean }> {
  const actuales = leerCacheLocal();
  const filtradas = actuales.filter((g) => g.id !== id);
  guardarCacheLocal(filtradas);

  if (supabase) {
    try {
      await supabase.from("gacetas_archivos").delete().eq("id", id);
    } catch {
      /* noop */
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gaceta:eliminada", { detail: { id } }));
  }

  return { ok: true };
}

/**
 * Descarga una gaceta directamente en el navegador del usuario/jugador.
 */
export function descargarArchivoGaceta(g: GacetaAlmacenada): void {
  if (typeof window === "undefined") return;

  try {
    const link = document.createElement("a");
    link.href = g.urlArchivo;
    link.download = g.nombreArchivo || `${g.hipodromo}_${g.fecha}.pdf`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error("Error descargando gaceta:", e);
    // Fallback: abrir en nueva pestaña
    window.open(g.urlArchivo, "_blank");
  }
}
