import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";

export type EjemplarPadron = {
  nombre: string;
  nacionalidad: string;
  registrado: string;
  totalTablas: number;
  ultimaTabla: string;
};

export type ResLeerPadron = {
  ok: boolean;
  data: EjemplarPadron[];
  error?: string;
  rls?: boolean;
};

const PAISES: Record<string, string> = {
  VE: "Venezuela",
  USA: "Estados Unidos",
  BR: "Brasil",
  AR: "Argentina",
  CL: "Chile",
  MX: "México",
  PA: "Panamá",
  PE: "Perú",
  CO: "Colombia",
  EC: "Ecuador",
  UY: "Uruguay",
};

const NOMBRES_PAIS: Record<string, Set<string>> = {
  VE: new Set(["VE", "VENEZUELA", "VEN"]),
  USA: new Set(["USA", "US", "EEUU", "ESTADOS UNIDOS", "EUA"]),
  BR: new Set(["BR", "BRA", "BRASIL", "BRAZIL"]),
  AR: new Set(["AR", "ARG", "ARGENTINA"]),
  CL: new Set(["CL", "CHILE"]),
  MX: new Set(["MX", "MEX", "MEXICO"]),
  PA: new Set(["PA", "PAN", "PANAMA", "PANAMÁ"]),
  PE: new Set(["PE", "PER", "PERU", "PERÚ"]),
  CO: new Set(["CO", "COL", "COLOMBIA"]),
  EC: new Set(["EC", "ECU", "ECUADOR"]),
  UY: new Set(["UY", "URU", "URUGUAY"]),
};

/** Bandera emoji a partir del código ISO-2 (same as legacy clubUI.bandera). */
export function bandera(nac: string): string {
  const c = (nac ?? "VE").toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(c)) return "🇻🇪";
  return String.fromCodePoint(...Array.from(c, (ch) => 127397 + ch.charCodeAt(0)));
}

export function nombrePais(nac: string): string {
  return PAISES[(nac ?? "VE").toUpperCase()] ?? (nac || "VE");
}

export function fmtFecha(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Lee el padrón (RPC segura con fallback al SELECT directo) + conteo de tablas. */
export async function leerPadron(): Promise<ResLeerPadron> {
  if (!supabase) {
    return { ok: false, data: [], error: "Sin credenciales Supabase (.env.local)." };
  }
  const safe = async <T>(p: PromiseLike<T>): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> => {
    try {
      const r = await p;
      const e = (r as { error?: { message?: string; code?: string } | null }).error;
      if (e) return { data: null, error: e };
      return { data: (r as { data?: T }).data ?? (r as T), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  };

  const rpc = await safe(supabase.rpc("club_listar_ejemplares"));
  const rE = Array.isArray(rpc.data)
    ? rpc
    : await safe(supabase.from("ejemplares").select("id, nombre, nacionalidad, created_at").order("nombre"));

  const rT = await safe(supabase.from("tablas_fijas").select("id, hipodromo, carrera, caballos"));

  const rEdata = (rE.data ?? null) as
    | Array<{ id: string | number; nombre: string; nacionalidad?: string | null; created_at?: string | null }>
    | null;
  const rTdata = rT.data;

  const err = rE.error as { message?: string; code?: string } | null | undefined;
  if (err) {
    const msj = err.message || err.code || String(err);
    return {
      ok: false,
      data: [],
      error: msj,
      rls: /row-level security|permission denied|42501|401/i.test(msj),
    };
  }

  const ejemplares = rEdata ?? [];
  const tablas = (rTdata ?? []) as Array<{
    id: string | number;
    hipodromo?: string | null;
    carrera?: number | null;
    caballos?: Array<{ ejemplar_id?: string | number } | null> | null;
  }>;

  const conteo = new Map<string, { tablas: Set<unknown>; idMayor: number; txt: string }>();
  for (const t of tablas) {
    for (const c of t.caballos ?? []) {
      if (!c || c.ejemplar_id == null) continue;
      const k = String(c.ejemplar_id);
      const info = conteo.get(k) ?? { tablas: new Set<unknown>(), idMayor: 0, txt: "" };
      info.tablas.add(t.id);
      if (Number(t.id) > info.idMayor) {
        info.idMayor = Number(t.id);
        info.txt = `${t.hipodromo || "?"} C${t.carrera ?? "?"}`;
      }
      conteo.set(k, info);
    }
  }

  const data: EjemplarPadron[] = ejemplares.map((e) => {
    const info = conteo.get(String(e.id));
    return {
      nombre: e.nombre,
      nacionalidad: e.nacionalidad || "VE",
      registrado: e.created_at ?? "",
      totalTablas: info ? info.tablas.size : 0,
      ultimaTabla: info ? info.txt : "",
    };
  });

  return { ok: true, data };
}

/** Filtro de padrón con la misma lógica de países que el legacy (ISO exacto vs subcadena). */
export function filtrarPadron(
  lista: EjemplarPadron[],
  termino: string
): EjemplarPadron[] {
  const f = termino.trim().toUpperCase();
  if (!f) return [...lista].sort((a, b) => b.totalTablas - a.totalTablas || a.nombre.localeCompare(b.nombre));

  let nacExacta = "";
  for (const [cod, sinonimos] of Object.entries(NOMBRES_PAIS)) {
    if (sinonimos.has(f)) {
      nacExacta = cod;
      break;
    }
  }

  return lista
    .filter((e) => {
      if (nacExacta) return (e.nacionalidad ?? "VE").toUpperCase() === nacExacta;
      return (e.nombre ?? "").toUpperCase().includes(f) || (e.nacionalidad ?? "").toUpperCase().includes(f);
    })
    .sort((a, b) => b.totalTablas - a.totalTablas || a.nombre.localeCompare(b.nombre));
}

/** Exporta el padrón a CSV (BOM UTF-8). */
export function exportarPadronCSV(lista: EjemplarPadron[]): void {
  const lineas = [["Nombre", "Nacionalidad", "Apariciones en Tablas", "Ultima Aparicion"].join(";")];
  [...lista]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .forEach((e) => lineas.push([e.nombre, e.nacionalidad, e.totalTablas, e.ultimaTabla].join(";")));
  const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "padron_ejemplares.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Nacionalidades soportadas (mismo catálogo del legacy gaceta). */
export const NACIONALIDADES = ["VE", "USA", "BR", "AR", "CL", "MX", "PA", "PE", "CO", "EC", "UY"];

export type ResAsegurarEjemplar = {
  ok: boolean;
  id?: string | number;
  nuevo?: boolean;
  error?: string;
};

/**
 * Asegura un ejemplar en la tabla `ejemplares` (paridad con legacy gaceta_padron.js).
 * Primero la RPC segura club_asegurar_ejemplar; si no existe, INSERT directo
 * completando las columnas NOT NULL que exija la BD. Devuelve el id.
 */
export async function asegurarEjemplar(nombre: string, nacionalidad: string): Promise<ResAsegurarEjemplar> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const nm = String(nombre || "").trim().toUpperCase().slice(0, 100);
  const nac = (String(nacionalidad || "VE").trim().toUpperCase() || "VE").slice(0, 3);
  if (!nm) return { ok: false, error: "Nombre vacío." };
  try {
    const r = await supabase.rpc("club_asegurar_ejemplar", { v_nombre: nm, v_nacionalidad: nac });
    if (!r.error && r.data != null) return { ok: true, id: r.data, nuevo: false };
  } catch {
    /* RPC inexistente → INSERT directo */
  }
  const extras: Record<string, number | string | boolean> = {};
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase
      .from("ejemplares")
      .insert(Object.assign({ nombre: nm, nacionalidad: nac }, extras))
      .select("id")
      .single();
    if (!error) return { ok: true, id: data?.id, nuevo: true };
    if (error.code === "23505") {
      const { data: existente } = await supabase.from("ejemplares").select("id").eq("nombre", nm).eq("nacionalidad", nac).limit(1).single();
      if (existente) return { ok: true, id: existente.id, nuevo: false };
      return { ok: false, error: "Registro duplicado y no localizable." };
    }
    const msj = String(error.message || "");
    const nullM = /null value in column "([^"]+)"/.exec(msj);
    if (nullM) {
      const col = nullM[1];
      if (extras[col] !== undefined) return { ok: false, error: msj };
      extras[col] = 0;
      continue;
    }
    const tipoM = /column "([^"]+)" is of type (?:text|character varying|boolean)/i.exec(msj);
    if (tipoM) {
      const col = tipoM[1];
      if (extras[col] !== undefined) return { ok: false, error: msj };
      extras[col] = /boolean/i.test(tipoM[2]) ? false : "";
      continue;
    }
    return { ok: false, error: msj, id: undefined };
  }
  return { ok: false, error: "Columnas requeridas faltantes en ejemplares" };
}

export type CaballoRegistrable = {
  nombre?: string;
  nacionalidad?: string;
  ejemplar_id?: string | number | null;
  nuevo?: boolean;
};

export type ResRegistrarEjemplares = {
  nuevos: number;
  vinculados: number;
  fallidos: number;
  errorDb?: string;
};

/**
 * Vincula cada caballo/ejemplar con su id del padrón, creando en `ejemplares`
 * los que no existan (misma lógica de legacy gaceta_padron.js registrar()).
 * Soporta carreras con `caballos` (shape programa_dia) o con `ejemplares` (IA).
 */
export async function registrarEjemplares(carreras: Array<Record<string, unknown>>): Promise<ResRegistrarEjemplares> {
    const totales: ResRegistrarEjemplares = { nuevos: 0, vinculados: 0, fallidos: 0 };
    if (!supabase) return totales;
    try {
      exigirCapacidad("ejemplares:fn_guardar_ejemplar");
    } catch (e) {
      return { ...totales, fallidos: carreras.length, errorDb: (e as Error).message };
    }


  const mapa = new Map<string, string | number>();
  try {
    const rpc = await supabase.rpc("club_listar_ejemplares");
    let data: Array<{ id: string | number; nombre?: string; nacionalidad?: string | null }> | null = null;
    if (!rpc.error && Array.isArray(rpc.data)) data = rpc.data as Array<{ id: string | number; nombre?: string; nacionalidad?: string | null }>;
    else {
      const directo = await supabase.from("ejemplares").select("id, nombre, nacionalidad");
      if (!directo.error) data = directo.data;
      else return { ...totales, errorDb: directo.error.message };
    }
    (data || []).forEach((e) => {
      const clave = `${String(e.nombre || "").trim().toUpperCase()}|${String(e.nacionalidad || "VE").trim().toUpperCase() || "VE"}`;
      mapa.set(clave, e.id);
    });
  } catch (e) {
    return { ...totales, errorDb: e instanceof Error ? e.message : String(e) };
  }

  const filas: CaballoRegistrable[] = [];
  for (const c of carreras) {
    const lote = ((c.caballos ?? c.ejemplares) as CaballoRegistrable[] | undefined) ?? [];
    for (const ej of lote) {
      if (!ej || typeof ej !== "object") continue;
      const nombre = String(ej.nombre || "").trim().toUpperCase().slice(0, 100);
      const nac = (String(ej.nacionalidad || "VE").trim().toUpperCase() || "VE").slice(0, 3);
      ej.nombre = nombre;
      ej.nacionalidad = nac;
      if (!nombre) continue;
      filas.push({ ...ej, nombre, nacionalidad: nac });
    }
  }

  for (const ej of filas) {
    const clave = `${ej.nombre}|${ej.nacionalidad}`;
    const existente = mapa.get(clave);
    if (existente != null) {
      ej.ejemplar_id = existente;
      ej.nuevo = false;
      totales.vinculados++;
      continue;
    }
    const r = await asegurarEjemplar(ej.nombre ?? "", ej.nacionalidad ?? "VE");
    if (!r.ok || r.id == null) {
      totales.fallidos++;
      totales.errorDb = totales.errorDb ?? r.error;
      continue;
    }
    ej.ejemplar_id = r.id;
    ej.nuevo = Boolean(r.nuevo);
    if (r.nuevo) totales.nuevos++;
    else totales.vinculados++;
    mapa.set(clave, r.id);
  }
  return totales;
}

export type ResHistorialGaceta = { ok: boolean; error?: string };

/** Lee el padrón para autocompletados (RPC club_listar_ejemplares → SELECT directo). */
export async function listarPadronSimple(): Promise<Array<{ id: string | number; nombre: string; nacionalidad: string }>> {
  if (!supabase) return [];
  try {
    const rpc = await supabase.rpc("club_listar_ejemplares");
    let data: Array<{ id: string | number; nombre?: string; nacionalidad?: string | null }> | null = null;
    if (!rpc.error && Array.isArray(rpc.data)) data = rpc.data as unknown as Array<NonNullable<typeof data>[number]>;
    else {
      const d = await supabase.from("ejemplares").select("id, nombre, nacionalidad").order("nombre");
      if (!d.error) data = d.data;
    }
    return (data ?? []).map((e) => ({
      id: e.id,
      nombre: String(e.nombre ?? "").toUpperCase(),
      nacionalidad: String(e.nacionalidad || "VE").toUpperCase(),
    }));
  } catch {
    return [];
  }
}

/** Inserta el historial de la transcripción en `gaceta_procesada` (paridad legacy). */
export async function guardarHistorialGaceta(carreras: unknown[], fecha?: string | null, creadoPor?: string): Promise<ResHistorialGaceta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { error } = await supabase.from("gaceta_procesada").insert({
      fecha_gaceta: fecha || null,
      num_carreras: Array.isArray(carreras) ? carreras.length : 0,
      contenido: Array.isArray(carreras) ? carreras : [],
      creado_por: creadoPor || "desconocido",
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// MEMORIA HISTÓRICA DE EJEMPLARES
// ============================================================================

/** Una actuación pasada de un ejemplar, tal como la devuelve la RPC. */
export type ActuacionHistorica = {
  fecha: string;
  hipodromo: string;
  carrera: number;
  /** Puesto obtenido (0 = no llegó al top 3 / no informado). */
  puesto: number;
  /** Distancia de esa carrera, en metros. */
  distancia: number;
  /** Superficie de esa carrera. */
  superficie: string;
  /** Premio de esa carrera. */
  premio: number;
};

/**
 * Memoria histórica de UN ejemplar: lo que el modelo necesita para proyectarlo.
 *
 * `indiceConsistenciaGodet` es el número que resume si el caballo cumple: la
 * proporción de sus actuaciones que lo dejaron arriba, con un peso por la
 * importancia de la carrera. Es el insumo que la pizarra Godet usa para
 * separar a un ejemplar constante de uno que lucky.
 */
export type MemoriaEjemplar = {
  nombre: string;
  nacionalidad: string;
  /** Cuántas carreras tiene registradas. */
  actuaciones: number;
  /** Cuántas veces terminó en el top 3. */
  placements: number;
  /** Porcentaje de aciertos (0-100). */
  winRate: number;
  /** Índice de Consistencia Godet (0-100). */
  indiceConsistenciaGodet: number;
  /** Último Beyer/Speed Rating conocido (0 si no hay). */
  speedRating: number;
  /** Historial de los ratings: sirve para ver la tendencia. */
  serieSpeedRating: number[];
  /** Jinete que más veces lo montó. */
  jineteHabitual: string;
  /** Entrenador que más veces lo tuvo. */
  entrenadorHabitual: string;
  /** Historial cronológico (más reciente primero). */
  historial: ActuacionHistorica[];
};

export type ResMemoria = {
  ok: boolean;
  data: MemoriaEjemplar[];
  /** Aviso: la RPC no está aplicada y se usó el padrón local. */
  aviso?: string;
  error?: string;
};

/**
 * Lee la memoria histórica de los ejemplares indicados.
 *
 * Usa la RPC `rpc_obtener_memoria_historica_caballos`, que es la única que
 * puede cruzar las carreras ya jugadas con los actuarios. Si la RPC todavía
 * no está instalada (o el rol no la puede leer), se cae a un fallback LOCAL
 * que reconstruye lo básico desde el padrón `ejemplares` y desde las carreras
 * ya registradas: menos datos, pero la pantalla nunca queda en blanco.
 */
export async function leerMemoriaHistorica(
  nombres: string[],
  fechaCorte?: string | null
): Promise<ResMemoria> {
  if (!supabase) return { ok: false, data: [], error: "Sin credenciales Supabase (.env.local)." };
  const limpios = [...new Set((nombres || []).map((n) => String(n || "").trim().toUpperCase()).filter(Boolean))];
  if (!limpios.length) return { ok: true, data: [] };

  const rpcAusente = (e: unknown): boolean => {
    const code = (e as { code?: string } | null)?.code;
    const msg = (e as { message?: string } | null)?.message ?? "";
    return code === "42883" || code === "PGRST202" || /does not exist|not found/i.test(msg);
  };

  try {
    const r = await supabase.rpc("rpc_obtener_memoria_historica_caballos", {
      p_nombres: limpios,
      p_fecha_corte: fechaCorte || null,
    });
    if (!r.error && Array.isArray(r.data)) {
      return { ok: true, data: (r.data as unknown as MemoriaEjemplar[]) ?? [] };
    }
    if (r.error && !rpcAusente(r.error)) {
      return { ok: false, data: [], error: r.error.message };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!rpcAusente(e)) return { ok: false, data: [], error: msg };
  }

  // FALLBACK LOCAL: sin la RPC, la memoria se reconstruye desde `ejemplares`
  // (padrón) y las carreras de la matriz. Es menos precisa, pero permite
  // trabajar antes de aplicar el SQL.
  const aviso = "Memoria histórica en modo local: falta aplicar sql/memoria_historica.sql.";
  try {
    const { data: ejemplares, error } = await supabase
      .from("ejemplares")
      .select("id, nombre, nacionalidad")
      .in("nombre", limpios);
    if (error) return { ok: false, data: [], error: error.message };
    const porNombre = new Map<string, { id: string | number; nacionalidad: string }>();
    for (const e of (ejemplares ?? []) as Array<{ id: string | number; nombre: string; nacionalidad?: string }>) {
      porNombre.set(String(e.nombre || "").trim().toUpperCase(), {
        id: e.id,
        nacionalidad: String(e.nacionalidad || "VE").toUpperCase(),
      });
    }
    const data: MemoriaEjemplar[] = [...porNombre.entries()].map(([nombre, info]) => ({
      nombre,
      nacionalidad: info.nacionalidad,
      actuaciones: 0,
      placements: 0,
      winRate: 0,
      indiceConsistenciaGodet: 0,
      speedRating: 0,
      serieSpeedRating: [],
      jineteHabitual: "",
      entrenadorHabitual: "",
      historial: [],
    }));
    return { ok: true, data, aviso };
  } catch (e) {
    return {
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Registra la gaceta procesada Y alimenta la memoria histórica de cada
 * ejemplar (RPC `rpc_registrar_gaceta_e_historial`).
 *
 * Son dos cosas que antes iban separadas y hoy van juntas: el historial dice
 * QUÉ gaceta se procesó, y la memoria dice qué hizo cada caballo en ella.
 * Sin la memoria, el modelo de proyección no tiene con qué trabajar.
 *
 * Si la RPC no está instalada, se cae al INSERT directo en `gaceta_procesada`
 * (que sí puede existir) y se avisa: la gaceta NO se pierde, solo la memoria
 * histórica queda sin alimentar.
 */
export async function registrarGacetaEHistorial(
  carreras: unknown[],
  fecha?: string | null,
  creadoPor?: string
): Promise<ResHistorialGaceta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const contenido = Array.isArray(carreras) ? carreras : [];
  const fechaIso = fecha ? String(fecha).slice(0, 10) : null;

  try {
    const r = await supabase.rpc("rpc_registrar_gaceta_e_historial", {
      p_fecha: fechaIso,
      p_carreras: contenido,
      p_creado_por: creadoPor || "desconocido",
    });
    if (!r.error) return { ok: true };
    const code = (r.error as { code?: string }).code;
    if (code !== "42883" && code !== "PGRST202") {
      // La RPC existe pero falló: se avisa, no se oculta.
      const directo = await guardarHistorialGaceta(contenido, fechaIso, creadoPor);
      return { ok: directo.ok, error: directo.ok ? r.error.message : directo.error };
    }
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "42883" && code !== "PGRST202") {
      const directo = await guardarHistorialGaceta(contenido, fechaIso, creadoPor);
      return { ok: directo.ok, error: directo.ok ? (e as Error).message : directo.error };
    }
  }

  // La RPC no está instalada: el historial se guarda igual, por la vía directa.
  const directo = await guardarHistorialGaceta(contenido, fechaIso, creadoPor);
  return {
    ok: directo.ok,
    error: directo.ok
      ? "Gaceta registrada, pero la memoria histórica no se alimentó: falta aplicar sql/memoria_historica.sql."
      : directo.error,
  };
}