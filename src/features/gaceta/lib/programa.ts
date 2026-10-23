/**
 * Servicio del "Programa del Día" — paridad con el legacy js/components/programa_dia.js.
 * Cada jornada es UNA fila en la tabla compartida `programa_dia`
 * (unique por fecha) con hipódromos y carreras en JSONB. El shape de cada
 * carrera es el mismo que persiste la gaceta/ensamblaje:
 *   { hipodromo, fecha, carrera, distancia, superficie, premio, caballos:[...] }
 */
import { supabase } from "@/core/supabase";
import { ordenarPorNumero } from "@/features/carreras/lib/maestro-nucleo";
import { fechaJornadaCaracas } from "@/core/utils/fechas";

export type CaballoPrograma = {
  numero: string | number;
  nombre: string;
  nacionalidad: string;
  valor?: number;
  ejemplar_id?: string | number | null;
  nuevo?: boolean;
  jockey?: string;
  entrenador?: string;
  stud?: string;
  haras?: string;
  pedigree?: { padre?: string; madre?: string; abueloMaterno?: string };
  edad?: number | string;
  sexo?: string;
  peso?: number | string;
  peso_programado?: number | string;
  peso_bruto?: number | string;
  descargo_aprendiz?: number | string;
  peso_neto?: number | string;
  peso_lbs?: number | string;
  descargo_lbs?: number | string;
  peso_fisico?: number | string;
  peso_optimo?: number | string;
  morning_line?: string;
  claiming_price?: number | string;
  beyer?: number | string;
  speed_rating?: number | string;
  pace_figures?: { early?: number; late?: number; e1?: number; e2?: number; e3?: number };
  aptitud_superficie?: Record<string, number | string | null>;
  retrospecto?: Array<Record<string, unknown>>;
  trackeos?: Array<Record<string, unknown>>;
  medicamento?: string;
  implementos?: string;
};

export type CarreraPrograma = {
  hipodromo: string;
  fecha?: string | null;
  carrera: number | null;
  estado?: string;
  distancia?: number;
  distancia_texto?: string;
  superficie?: string;
  condicion_pista?: string;
  condicion_carrera?: string;
  codigo_carrera?: string;
  hora?: string;
  premio?: number;
  morning_line?: string;
  beyer_par?: number | string;
  record_pista?: string;
  caballos: CaballoPrograma[];
};

export type ProgramaDia = {
  fecha: string;
  hipodromos: string[];
  carreras: CarreraPrograma[];
  resumen?: string;
  creado_por?: string | null;
};

export type ResPrograma = { ok: boolean; data?: ProgramaDia | null; error?: string };

/**
 * Fecha de la jornada en ISO `YYYY-MM-DD`, bajo la zona de Caracas (UTC-4).
 *
 * ANTES usaba `getFullYear()/getMonth()/getDate()` del reloj LOCAL del
 * navegador: si el operador tenía el celular en Miami, o si la app corría en
 * un servidor en UTC, el día se partía al revés. Y un `toISOString()` a las
 * 20:00 devolvía MAÑANA: las carreras nocturnas se guardaban en el día
 * siguiente y el operador no las veía en el filtro del día en que se jugaron.
 *
 * Ahora DELEGA en `fechaJornadaCaracas`, que es la fuente única de la zona
 * horaria de la jornada (ver `src/core/utils/fechas.ts`).
 */
export function hoyLocal(): string {
  return fechaJornadaCaracas();
}

function norm(c: unknown): CarreraPrograma {
  const x = (c ?? {}) as Record<string, unknown>;
  const caballos = ordenarPorNumero(
    Array.isArray(x.caballos)
      ? (x.caballos as Array<Record<string, unknown>>).map((cb) => ({
          numero: (cb.numero ?? "") as string | number,
          nombre: String(cb.nombre ?? "").toUpperCase(),
          nacionalidad: String(cb.nacionalidad ?? "VE").toUpperCase() || "VE",
          valor: Number(cb.valor ?? cb.pts ?? 0) || 0,
          ejemplar_id: (cb.ejemplar_id as string | number | null | undefined) ?? null,
          jockey: cb.jockey ? String(cb.jockey) : undefined,
          entrenador: cb.entrenador ? String(cb.entrenador) : undefined,
          stud: cb.stud ? String(cb.stud) : undefined,
          haras: cb.haras ? String(cb.haras) : undefined,
          pedigree: cb.pedigree && typeof cb.pedigree === "object" ? cb.pedigree as CaballoPrograma["pedigree"] : undefined,
          edad: cb.edad as string | number | undefined,
          sexo: cb.sexo ? String(cb.sexo) : undefined,
          peso: cb.peso !== undefined ? (cb.peso as string | number) : undefined,
          peso_programado: cb.peso_programado as string | number | undefined,
          peso_bruto: cb.peso_bruto as string | number | undefined,
          descargo_aprendiz: cb.descargo_aprendiz as string | number | undefined,
          peso_neto: cb.peso_neto as string | number | undefined,
          peso_lbs: cb.peso_lbs as string | number | undefined,
          descargo_lbs: cb.descargo_lbs as string | number | undefined,
          peso_fisico: cb.peso_fisico as string | number | undefined,
          peso_optimo: cb.peso_optimo as string | number | undefined,
          morning_line: cb.morning_line ? String(cb.morning_line) : undefined,
          claiming_price: cb.claiming_price as string | number | undefined,
          beyer: cb.beyer as string | number | undefined,
          speed_rating: cb.speed_rating as string | number | undefined,
          pace_figures: cb.pace_figures && typeof cb.pace_figures === "object" ? cb.pace_figures as CaballoPrograma["pace_figures"] : undefined,
          aptitud_superficie: cb.aptitud_superficie as CaballoPrograma["aptitud_superficie"],
          retrospecto: Array.isArray(cb.retrospecto) ? cb.retrospecto as CaballoPrograma["retrospecto"] : undefined,
          trackeos: Array.isArray(cb.trackeos) ? cb.trackeos as CaballoPrograma["trackeos"] : undefined,
          medicamento: cb.medicamento ? String(cb.medicamento) : undefined,
          implementos: cb.implementos ? String(cb.implementos) : undefined,
        }))
      : []
  );
  return {
    hipodromo: String(x.hipodromo ?? "").toUpperCase(),
    fecha: x.fecha ? String(x.fecha) : null,
    carrera: x.carrera != null ? Number(x.carrera) || null : null,
    estado: x.estado ? String(x.estado) : undefined,
    distancia: Number(x.distancia) || 0,
    distancia_texto: x.distancia_texto ? String(x.distancia_texto) : undefined,
    superficie: String(x.superficie ?? "ARENA").toUpperCase() || "ARENA",
    condicion_pista: x.condicion_pista ? String(x.condicion_pista) : undefined,
    condicion_carrera: x.condicion_carrera ? String(x.condicion_carrera) : undefined,
    codigo_carrera: x.codigo_carrera ? String(x.codigo_carrera) : undefined,
    hora: x.hora ? String(x.hora) : undefined,
    premio: Number(x.premio) || 0,
    morning_line: x.morning_line ? String(x.morning_line) : undefined,
    beyer_par: x.beyer_par as number | string | undefined,
    record_pista: x.record_pista ? String(x.record_pista) : undefined,
    caballos,
  };
}

/** Lee la fila `fecha` del programa del día (RPC primero → SELECT directo con fallback). */
export async function leerProgramaPorFecha(fecha: string): Promise<ResPrograma> {
  if (!supabase) return { ok: true, data: null };
  const build = (t: Record<string, unknown> | null | undefined): ProgramaDia | null =>
    t
      ? {
          fecha: String(t.fecha ?? fecha),
          hipodromos: Array.isArray(t.hipodromos) ? t.hipodromos.map((h) => String(h).toUpperCase()) : [],
          carreras: Array.isArray(t.carreras) ? (t.carreras as unknown[]).map(norm) : [],
          resumen: t.resumen ? String(t.resumen) : "",
          creado_por: t.creado_por ? String(t.creado_por) : null,
        }
      : null;

  try {
    const viaRpc = await supabase.rpc("club_leer_programa_dia");
    if (!viaRpc.error && Array.isArray(viaRpc.data) && viaRpc.data.length) {
      const fila = viaRpc.data.find((x: Record<string, unknown>) => String(x.fecha) === fecha) ?? viaRpc.data[0];
      return { ok: true, data: build(fila) };
    }
  } catch {
    /* RPC inexistente → SELECT directo */
  }
  try {
    const { data, error } = await supabase
      .from("programa_dia")
      .select("fecha, hipodromos, carreras, resumen, creado_por, updated_at")
      .eq("fecha", fecha)
      .maybeSingle();
    if (error) return { ok: true, data: null };
    return { ok: true, data: build(data as Record<string, unknown> | null) };
  } catch {
    return { ok: true, data: null };
  }
}

/**
 * La RPC `club_guardar_programa_dia` es la única vía que valida la capacidad
 * del operador en el servidor. Antes, si fallaba, el código caía a un
 * `.upsert()` directo sobre `programa_dia`, y eso obligaba a dejar la tabla
 * abierta al rol anon: cualquiera con la anon key podía reescribir el
 * programa del día.
 *
 * El fallback se conserva SOLO para el caso en que la función todavía no
 * esté instalada (código 42883 / 404). Cualquier otro error se propaga:
 * si la vía validada falla, el operador tiene que enterarse, no ver
 * "guardado" por un atajo que no pasó por ninguna validación.
 */
function rpcAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "42883" || code === "PGRST202";
}

/**
 * Da de alta las carreras del programa en la MATRIZ MAESTRA `carreras`.
 *
 * `programa_dia` guarda el día entero como un JSONB: sirve para el documento y
 * para el respaldo, pero no se puede consultar por carrera. La matriz guarda una
 * fila por (fecha, hipódromo, carrera), que es lo que leen Tablas, Marcas,
 * Gestión, Dupletas, Liquidación y Remates. Guardar el programa y que la carrera
 * exista para todos los módulos es la MISMA operación.
 *
 * `import()` dinámico a propósito: `carreras/maestro` usa `hoyLocal` de este
 * archivo, así que un import estático sería un ciclo.
 *
 * La carga del programa no se considera completa si el catálogo central no se
 * pudo actualizar: carreras y jugadas deben consultar la misma matriz.
 */
async function registrarCarrerasEnMatriz(
  fecha: string,
  carreras: CarreraPrograma[]
): Promise<{ ok: boolean; guardadas: number; error?: string }> {
  const validas = carreras.filter((c) => c.hipodromo && Number(c.carrera) > 0);
  if (!validas.length) return { ok: true, guardadas: 0 };
  try {
    const { escribirCarrerasMaestro } = await import("@/features/carreras/lib/maestro");
    const res = await escribirCarrerasMaestro(
      validas.map((c) => ({
        fecha,
        hipodromo: String(c.hipodromo).toUpperCase(),
        carrera: Number(c.carrera),
        estado: c.estado ?? "Programada",
        caballos: c.caballos ?? [],
        distancia: c.distancia ? String(c.distancia) : null,
        superficie: c.superficie ?? null,
        premio: c.premio ?? null,
        distancia_texto: c.distancia_texto ?? null,
        condicion_pista: c.condicion_pista ?? null,
        condicion_carrera: c.condicion_carrera ?? null,
        codigo_carrera: c.codigo_carrera ?? null,
        hora: c.hora ?? null,
        morning_line: c.morning_line ?? null,
        beyer_par: c.beyer_par ?? null,
        record_pista: c.record_pista ?? null,
        origen: "ia",
        // El programa llega por LOTES: la lista de ejemplares se ACUMULA con la
        // que ya está guardada (por número de gualdrapa). Sin esto, un lote
        // parcial borraba los ejemplares del lote anterior y la carrera se
        // quedaba con la mitad del padrón.
        fusionar_ejemplares: true,
      }))
    );
    if (!res.ok) {
      return {
        ok: false,
        guardadas: 0,
        error: res.error ?? "No se pudo registrar el programa en el catálogo central.",
      };
    }
    return { ok: true, guardadas: res.guardadas ?? 0 };
  } catch (e) {
    return {
      ok: false,
      guardadas: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function confirmarCargaEnCatalogo(
  fecha: string,
  carreras: CarreraPrograma[]
): Promise<{ ok: boolean; error?: string }> {
  const resultado = await registrarCarrerasEnMatriz(fecha, carreras);
  if (resultado.ok) return { ok: true };
  return {
    ok: false,
    error:
      `No se pudo registrar la carga en el catálogo único de carreras: ${resultado.error}. ` +
      "Reintenta la carga; Gestión y las jugadas solo mostrarán carreras registradas en ese catálogo.",
  };
}

export async function guardarPrograma(
  p: ProgramaDia,
  creadoPor?: string,
  opciones: { registrarEnMatriz?: boolean } = {}
): Promise<{ ok: boolean; data?: ProgramaDia; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const fecha = p.fecha || hoyLocal();
  const hipodromos = [...new Set((p.hipodromos || []).map((h) => String(h).toUpperCase().trim()).filter(Boolean))];
  const carreras = (p.carreras || []).filter((c) => c.hipodromo).map(norm);
  const resumen = `${carreras.length} carrera(s) · ${hipodromos.join(", ")}`;
  const normP: ProgramaDia = { fecha, hipodromos, carreras, resumen, creado_por: creadoPor || "desconocido" };

  try {
    const r = await supabase.rpc("club_guardar_programa_dia", {
      p_fecha: fecha,
      p_hipodromos: hipodromos,
      p_carreras: carreras,
      p_creado_por: creadoPor || "desconocido",
    });
    if (r.error) {
      if (!rpcAusente(r.error)) {
        if (opciones.registrarEnMatriz === false) return { ok: false, error: r.error.message };
        // El documento del día (`programa_dia`) no se pudo guardar, pero la
        // MATRIZ —de donde leen TODOS los módulos— se escribe igual: sin esto la
        // carrera quedaría invisible aunque el operador ya la haya cargado.
        const matriz = await confirmarCargaEnCatalogo(fecha, carreras);
        if (!matriz.ok) return { ok: false, error: `${r.error.message} ${matriz.error}` };
        return { ok: false, error: r.error.message };
      }
      throw r.error;
    }
    if (opciones.registrarEnMatriz !== false) {
      const matriz = await confirmarCargaEnCatalogo(fecha, carreras);
      if (!matriz.ok) return { ok: false, error: matriz.error };
    }
    return { ok: true, data: normP };
  } catch (e1) {
    // La RPC no está instalada: caemos al upsert directo para no dejar al
    // operador sin poder guardar, y avisamos que se usó la vía sin control.
    if (!rpcAusente(e1)) {
      return { ok: false, error: e1 instanceof Error ? e1.message : String(e1) };
    }
    try {
      const { error } = await supabase.from("programa_dia").upsert(normP, { onConflict: "fecha" });
      if (error) return { ok: false, error: error.message };
      if (opciones.registrarEnMatriz !== false) {
        const matriz = await confirmarCargaEnCatalogo(fecha, carreras);
        if (!matriz.ok) return { ok: false, error: matriz.error };
      }
      return { ok: true, data: normP };
    } catch (e2) {
      return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}