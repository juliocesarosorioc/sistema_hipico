import { supabase } from "@/core/supabase";

export type ExpedienteEjemplar = {
  id: string;
  ejemplar_id: string | null;
  nombre: string;
  nombre_normalizado: string;
  pais: string;
  peso_fisico_kg: number | null;
  peso_optimo_kg: number | null;
  historial: Array<Record<string, unknown>>;
  trackeos: Array<Record<string, unknown>>;
  notas_analista: string | null;
};

export type DatosExpediente = {
  nombre: string;
  pais?: string | null;
  ejemplarId?: string | number | null;
  pesoFisicoKg?: number | null;
  pesoOptimoKg?: number | null;
  historial?: Array<Record<string, unknown>>;
  trackeos?: Array<Record<string, unknown>>;
  notas?: string | null;
};

export type ResultadoExpediente = { ok: boolean; data?: ExpedienteEjemplar | null; error?: string };
export type IdentidadEjemplar = { nombre: string; pais?: string | null };

export async function leerExpedienteEjemplar(
  nombre: string,
  pais?: string | null
): Promise<ResultadoExpediente> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase." };
  const [nombreNormalizado, paisNormalizado] = claveEjemplarHistorico(nombre, pais).split("|");
  if (!nombreNormalizado) return { ok: false, error: "El nombre del ejemplar es obligatorio." };

  try {
    const { data, error } = await supabase
      .from("expediente_inteligencia_ejemplares")
      .select("id, ejemplar_id, nombre, nombre_normalizado, pais, peso_fisico_kg, peso_optimo_kg, historial, trackeos, notas_analista")
      .eq("nombre_normalizado", nombreNormalizado)
      .eq("pais", paisNormalizado)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data as ExpedienteEjemplar | null) ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function leerExpedientesEjemplares(
  identidades: IdentidadEjemplar[]
): Promise<{ data: ExpedienteEjemplar[]; error?: string }> {
  const db = supabase;
  if (!db) return { data: [], error: "Sin credenciales Supabase." };
  const grupos = new Map<string, Set<string>>();
  for (const identidad of identidades) {
    const [nombre, pais] = claveEjemplarHistorico(identidad.nombre, identidad.pais).split("|");
    if (!nombre) continue;
    const nombres = grupos.get(pais) ?? new Set<string>();
    nombres.add(nombre);
    grupos.set(pais, nombres);
  }
  try {
    const resultados = await Promise.all(
      [...grupos].map(async ([pais, nombres]) => {
        const respuesta = await db
          .from("expediente_inteligencia_ejemplares")
          .select("id, ejemplar_id, nombre, nombre_normalizado, pais, peso_fisico_kg, peso_optimo_kg, historial, trackeos, notas_analista")
          .eq("pais", pais)
          .in("nombre_normalizado", [...nombres]);
        return respuesta;
      })
    );
    const error = resultados.find((resultado) => resultado.error)?.error;
    if (error) return { data: [], error: error.message };
    return {
      data: resultados.flatMap((resultado) => (resultado.data ?? []) as ExpedienteEjemplar[]),
    };
  } catch (error) {
    return { data: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function guardarDatosExpediente(
  datos: DatosExpediente
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase." };
  if (!datos.nombre.trim()) return { ok: false, error: "El nombre del ejemplar es obligatorio." };

  try {
    const { error } = await supabase.rpc("rpc_guardar_expediente_inteligencia_ejemplar", {
      p_nombre: datos.nombre,
      p_pais: datos.pais ?? "VE",
      p_ejemplar_id: datos.ejemplarId ? String(datos.ejemplarId) : null,
      p_peso_fisico_kg: datos.pesoFisicoKg ?? null,
      p_peso_optimo_kg: datos.pesoOptimoKg ?? null,
      p_historial: datos.historial ?? [],
      p_trackeos: datos.trackeos ?? [],
      p_notas: datos.notas ?? null,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function registrarExpedientesDeCarreras(
  carreras: Array<{
    ejemplares?: unknown;
    caballos?: unknown;
  }>
): Promise<{ guardados: number; fallidos: string[] }> {
  const unicos = new Map<string, DatosExpediente>();
  for (const carrera of carreras) {
    const lista = Array.isArray(carrera.ejemplares)
      ? carrera.ejemplares
      : Array.isArray(carrera.caballos)
        ? carrera.caballos
        : [];
    for (const candidato of lista) {
      if (!candidato || typeof candidato !== "object") continue;
      const ejemplar = candidato as Record<string, unknown>;
      const nombre = String(ejemplar.nombre ?? "").trim();
      if (!nombre) continue;
      const pais = String(ejemplar.nacionalidad ?? ejemplar.pais_origen ?? "VE");
      const key = claveEjemplarHistorico(nombre, pais);
      const previo = unicos.get(key) ?? { nombre, pais };
      const historial = Array.isArray(ejemplar.retrospecto)
        ? [...(previo.historial ?? []), ...(ejemplar.retrospecto as Array<Record<string, unknown>>)]
        : previo.historial ?? [];
      const trackeos = Array.isArray(ejemplar.trackeos)
        ? [...(previo.trackeos ?? []), ...(ejemplar.trackeos as Array<Record<string, unknown>>)]
        : previo.trackeos ?? [];
      unicos.set(key, {
        ...previo,
        ejemplarId: esUuid(ejemplar.ejemplar_id) ? ejemplar.ejemplar_id : previo.ejemplarId,
        pesoFisicoKg: numeroPositivo(ejemplar.peso_fisico) ?? previo.pesoFisicoKg,
        pesoOptimoKg: numeroPositivo(ejemplar.peso_optimo) ?? previo.pesoOptimoKg,
        historial: deduplicarObjetos(historial),
        trackeos: deduplicarObjetos(trackeos),
      });
    }
  }

  const resultados = await Promise.all(
    [...unicos.values()].map(async (datos) => ({ datos, resultado: await guardarDatosExpediente(datos) }))
  );
  return {
    guardados: resultados.filter(({ resultado }) => resultado.ok).length,
    fallidos: resultados
      .filter(({ resultado }) => !resultado.ok)
      .map(({ datos, resultado }) => `${datos.nombre}: ${resultado.error ?? "Error desconocido"}`),
  };
}

function numeroPositivo(valor: unknown): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function deduplicarObjetos(lista: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...new Map(lista.map((objeto) => [JSON.stringify(objeto), objeto])).values()];
}

function claveEjemplarHistorico(nombre: unknown, pais: unknown): string {
  const nombreNormalizado = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const paisTexto = String(pais ?? "VE").trim().toUpperCase() || "VE";
  const paisNormalizado: Record<string, string> = {
    VEN: "VE",
    VENEZUELA: "VE",
    US: "USA",
    EUA: "USA",
    EEUU: "USA",
    MEX: "MX",
    BRA: "BR",
    ARG: "AR",
    PAN: "PA",
    PER: "PE",
    COL: "CO",
    URU: "UY",
  };
  return `${nombreNormalizado}|${paisNormalizado[paisTexto] ?? paisTexto}`;
}
