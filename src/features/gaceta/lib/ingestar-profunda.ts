import { supabase } from "@/core/supabase";

export type CarreraPreviaProfunda = {
  fecha: string;
  hipodromo?: string;
  numero_carrera?: string | number;
  peso_fisico_kg?: number | null;
  distancia_m?: number | null;
  pp?: number | null;
  pos_400m?: number | null;
  pos_800m?: number | null;
  pos_llegada?: number | null;
  peso_jinete_kg?: number | null;
  jinete?: string | null;
  dividendo?: string | null;
  ganador?: string | null;
  cuerpos?: string | null;
  lote?: string | null;
  rating?: number | null;
  ttc?: number | null;
  tiempo_ganador?: string | null;
  tiempo_ejemplar?: string | null;
  total_ejemplares?: number | null;
  superficie?: string | null;
  condicion_pista?: string | null;
};

export type TrabajoProfundo = {
  fecha?: string | null;
  hipodromo?: string | null;
  distancia_m?: number | null;
  tiempo?: string | null;
  remate?: string | null;
  modalidad?: string | null;
  pista?: string | null;
  superficie_estado?: string | null;
  ranking?: string | null;
  comentario?: string | null;
  dias_atras?: number | null;
};

export type EjemplarProfundoIngesta = {
  numero_programa: string;
  puesto_partida?: number | null;
  nombre: string;
  pais_origen?: string;
  fecha_nacimiento?: string | null;
  anio_nacimiento?: number | null;
  stud?: string | null;
  sexo?: string | null;
  pelaje?: string | null;
  padre?: string | null;
  madre?: string | null;
  abuelo_materno?: string | null;
  haras_criador?: string | null;
  dias_sin_correr?: number | null;
  ganancias_usd?: number | null;
  jinete?: string | null;
  entrenador?: string | null;
  peso_base_kg?: number | null;
  descargo_kg?: number | null;
  peso_kg?: number | null;
  implementos?: string | null;
  campana_resumen?: string | null;
  comentario?: string | null;
  morning_line?: string | null;
  es_elegible?: boolean;
  retirado?: boolean;
  carreras_previas?: CarreraPreviaProfunda[];
  trabajos?: TrabajoProfundo[];
};

export type CarreraProfundaIngesta = {
  hipodromo: string;
  codigo_hipodromo?: string | null;
  fecha: string;
  hora?: string | null;
  numero_carrera: number;
  codigo_anual?: string | null;
  valida_5y6?: number | null;
  distancia_m?: number | null;
  superficie?: string | null;
  raza?: string | null;
  bolsa_usd?: number | null;
  condicion_lote?: string | null;
  condicion_lote_completa?: string | null;
  record_pista?: string | null;
  favoritos_gaceta?: string[];
  orden_rating_gaceta?: string[];
  ejemplares: EjemplarProfundoIngesta[];
};

export type PayloadGacetaProfunda = {
  carreras: CarreraProfundaIngesta[];
};

export type ResultadoIngestaProfunda = {
  ok: boolean;
  carreras_procesadas?: number;
  ejemplares_procesados?: number;
  actuaciones_procesadas?: number;
  trabajos_procesados?: number;
  error?: string;
};

/**
 * Invoca el RPC `ingestar_gaceta_profunda` en Supabase.
 * Preserva intacta la historia previa y trabajos sin duplicar.
 */
export async function ingestarGacetaProfunda(
  payload: PayloadGacetaProfunda | CarreraProfundaIngesta[]
): Promise<ResultadoIngestaProfunda> {
  const normalizado: PayloadGacetaProfunda = Array.isArray(payload)
    ? { carreras: payload }
    : payload;

  if (!normalizado.carreras || normalizado.carreras.length === 0) {
    return { ok: false, error: "El payload no contiene carreras para ingestar." };
  }

  if (!supabase) {
    return { ok: true, carreras_procesadas: normalizado.carreras.length };
  }

  try {
    const { data, error } = await supabase.rpc("ingestar_gaceta_profunda", {
      payload: normalizado,
    });

    if (error) {
      console.warn("Aviso al invocar ingestar_gaceta_profunda RPC:", error.message);
      return { ok: false, error: error.message };
    }

    const res = data as ResultadoIngestaProfunda | null;
    return {
      ok: res?.ok ?? true,
      carreras_procesadas: res?.carreras_procesadas ?? normalizado.carreras.length,
      ejemplares_procesados: res?.ejemplares_procesados ?? 0,
      actuaciones_procesadas: res?.actuaciones_procesadas ?? 0,
      trabajos_procesados: res?.trabajos_procesados ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error en ingestarGacetaProfunda:", msg);
    return { ok: false, error: msg };
  }
}
