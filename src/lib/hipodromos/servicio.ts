/**
 * Servicio CRUD de Hipódromos contra la tabla compartida `hipodromos`
 * (mismo backend Supabase que el legacy — sin scripts de migración de datos).
 * Sin credenciales → respaldo en memoria para que la UI siga operativa.
 *
 * BAJA LÓGICA (sql/hipodromos.sql)
 * --------------------------------
 * Eliminar NO borra la fila: marca `eliminado_en`. Antes el DELETE físico
 * reventaba por FK en cuanto el hipódromo tenía una carrera, una tabla o un
 * ticket — que es exactamente lo que pasa con cualquier hipódromo real. Ahora la
 * fila queda archivada: no se ofrece en ningún selector, pero todo lo que ya se
 * registró con ese nombre sigue ahí. Reagregarlo REACTIVA la misma fila (el
 * nombre tiene índice único, así que un INSERT nuevo daría 23505).
 *
 * SIN WHITELIST
 * -------------
 * Antes `permitidos()` filtraba por una lista fija (VE + USA): cualquier
 * hipódromo registrado fuera de esa lista era invisible aunque estuviera en la
 * base. Ahora sale TODO lo registrado; lo único que se oculta son los archivados.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, exigirPermiso } from "@/lib/seguridad/vigente";
import {
  estaBorrado,
  formatearNombre,
  normalizarEstado,
  type Hipodromo,
  type ResCrud,
  type ResListar,
} from "@/lib/hipodromos/tipos";

/**
 * Catálogo de respaldo (sin conexión), paridad con el listado de la taquilla.
 * Los nombres van en MAYÚSCULAS porque es como se guardan y como los compara el
 * resto de la plataforma.
 */
const RESERVA: Array<Pick<Hipodromo, "nombre" | "pais" | "estado">> = [
  { nombre: "LA RINCONADA", pais: "VE", estado: "Activo" },
  { nombre: "VALENCIA", pais: "VE", estado: "Activo" },
  { nombre: "SANTA RITA", pais: "VE", estado: "Activo" },
  { nombre: "POMONA", pais: "VE", estado: "Activo" },
  { nombre: "GULFSTREAM", pais: "USA", estado: "Activo" },
  { nombre: "AQUEDUCT", pais: "USA", estado: "Activo" },
  { nombre: "BELMONT", pais: "USA", estado: "Activo" },
  { nombre: "KEENELAND", pais: "USA", estado: "Activo" },
  { nombre: "SANTA ANITA", pais: "USA", estado: "Activo" },
  { nombre: "DEL MAR", pais: "USA", estado: "Activo" },
  { nombre: "WOODBINE", pais: "OTRO", estado: "Activo" },
];

let cacheLocal: Hipodromo[] = [];
let sembrada = false;

function sembrarReserva(): Hipodromo[] {
  if (sembrada) return cacheLocal;
  cacheLocal = RESERVA.map((h, i) => ({
    id: `local-${i + 1}`,
    nombre: h.nombre,
    pais: h.pais,
    estado: h.estado,
    fecha_creacion: null,
    eliminado_en: null,
  }));
  sembrada = true;
  return cacheLocal;
}

const normalizar = (r: Record<string, unknown>): Hipodromo => ({
  id: String(r.id ?? ""),
  nombre: String(r.nombre ?? ""),
  pais: String(r.pais ?? "OTRO").toUpperCase(),
  estado: normalizarEstado(r.estado),
  fecha_creacion: r.fecha_creacion ? String(r.fecha_creacion) : null,
  eliminado_en: r.eliminado_en ? String(r.eliminado_en) : null,
  eliminado_por: r.eliminado_por ? String(r.eliminado_por) : null,
});

/**
 * SELECT * de hipódromos, ordenados alfabéticamente.
 *
 * `incluirBorrados: true` trae también los archivados (los usa la sección
 * "Archivados" del CRUD, para poder reactivarlos). Por defecto quedan fuera, que
 * es lo que necesitan los selectores de Marcas, Tablas, Gestión y Dupletas.
 */
export async function listarHipodromos(opciones?: { incluirBorrados?: boolean }): Promise<ResListar> {
  const incluirBorrados = Boolean(opciones?.incluirBorrados);
  if (supabase) {
    try {
      let q = supabase.from("hipodromos").select("*");
      // Filtro en el servidor: las filas archivadas no deben viajar ni ocupar
      // memoria en los módulos que solo necesitan los vigentes.
      if (!incluirBorrados) q = q.is("eliminado_en", null);
      const { data, error } = await q.order("nombre", { ascending: true });
      if (!error && Array.isArray(data)) {
        cacheLocal = (data as unknown[]).map((r) => normalizar(r as Record<string, unknown>));
        sembrada = true;
        return { ok: true, data: cacheLocal };
      }
      if (error) {
        // La columna `eliminado_en` todavía no existe (falta aplicar
        // sql/hipodromos.sql): se lee sin filtrar para no dejar el CRUD vacío.
        const plano = await supabase.from("hipodromos").select("*").order("nombre", { ascending: true });
        if (!plano.error && Array.isArray(plano.data)) {
          cacheLocal = (plano.data as unknown[]).map((r) => normalizar(r as Record<string, unknown>));
          sembrada = true;
          return { ok: true, data: incluirBorrados ? cacheLocal : cacheLocal.filter((h) => !estaBorrado(h)) };
        }
      }
    } catch {
      /* sin conexión → respaldo */
    }
  }
  const reserva = sembrarReserva();
  return { ok: true, data: incluirBorrados ? reserva : reserva.filter((h) => !estaBorrado(h)), local: true };
}

/**
 * Da de alta un hipódromo. Si el nombre YA EXISTE pero está archivado, en vez de
 * fallar (el nombre tiene índice único) REACTIVA esa fila: mismo id, mismo
 * historial de carreras, tablas y tickets.
 */
export async function crearHipodromo(datos: { nombre: string; pais: string }): Promise<ResCrud> {
  try {
    // El operador solo puede crear hipódromos de los suyos. El principal
    // (dueño) no está atado a esa lista y puede crear cualquiera.
    //
    // Se valida el nombre YA FORMATEADO, no el que venga del formulario: lo que
    // se guarda es `formatearNombre(datos.nombre)`, así que " la trinidad " y
    // "La Trinidad" terminan en la misma fila. Validar el texto crudo hacía que
    // el operador perdiera el permiso por un espacio de más.
    exigirPermiso("hipodromos:fn_guardar_hipodromo", { hipodromo: formatearNombre(datos.nombre) });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const nombre = formatearNombre(datos.nombre);
  const pais = String(datos.pais || "OTRO").toUpperCase();
  if (!supabase) {
    const previa = cacheLocal.find((h) => h.nombre.trim().toUpperCase() === nombre.toUpperCase());
    if (previa && estaBorrado(previa)) {
      const reactivado: Hipodromo = { ...previa, estado: "Activo", eliminado_en: null, eliminado_por: null };
      cacheLocal = cacheLocal.map((h) => (String(h.id) === String(previa.id) ? reactivado : h));
      return { ok: true, reactivado: true };
    }
    if (previa) {
      return {
        ok: false,
        error: `El hipódromo "${nombre}" ya existe y está vigente. Edítelo o suspéndalo en lugar de agregarlo de nuevo.`,
        code: "23505",
      };
    }
    const id = `local-${Date.now().toString(36)}`;
    cacheLocal = [...cacheLocal, { id, nombre, pais, estado: "Activo", fecha_creacion: null, eliminado_en: null }].sort((a, b) =>
      a.nombre.localeCompare(b.nombre)
    );
    return { ok: true };
  }
  try {
    // 1) ¿Hay una fila archivada con ese nombre? Se busca por nombre exacto,
    //    ignora mayúsculas por el lado del cliente: es la única vía de reanimar
    //    sin adivinar el formato en que quedó guardado.
    const { data: previa } = await supabase
      .from("hipodromos")
      .select("id, nombre, eliminado_en")
      .ilike("nombre", nombre)
      .maybeSingle();
    if (previa) {
      // Solo se reanima lo que estaba ARCHIVADO. Si la fila ya está vigente, el
      // alta no es una reactivación: es un duplicado, y responder "reactivado"
      // mentía (además pisaba el país con el del formulario).
      if (!estaBorrado(previa as Hipodromo)) {
        return {
          ok: false,
          error: `El hipódromo "${nombre}" ya existe y está vigente. Edítelo o suspéndalo en lugar de agregarlo de nuevo.`,
          code: "23505",
        };
      }
      const { error } = await supabase
        .from("hipodromos")
        .update({ estado: "Activo", eliminado_en: null, eliminado_por: null, pais })
        .eq("id", previa.id);
      if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
      return { ok: true, reactivado: true };
    }
    const { error } = await supabase.from("hipodromos").insert([{ nombre, pais }]);
    if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** UPDATE { nombre, pais, estado } por id. */
export async function actualizarHipodromo(id: string | number, patch: Partial<Pick<Hipodromo, "nombre" | "pais" | "estado">>): Promise<ResCrud> {
  try {
    // Se validan DOS nombres, no uno: el que TIENE la fila y el que QUEDA.
    //
    // Validar solo el nombre del patch era un agujero: el operador mandaba
    // `{ nombre: "LA TRINIDAD" }` (que sí es suyo, así que pasaba) con el id de
    // "LA GRITA", y el update escribía sobre la fila de la Grita. El nombre
    // que se validaba era del hipódromo propio; el id, del ajeno.
    //
    // El nombre actual se resuelve contra la fila real: `patch.nombre` describe
    // adónde se va, nunca de dónde se viene.
    const actual = await nombreDeHipodromo(id);
    if (actual === null) {
      return { ok: false, error: "No se encontró el hipódromo a actualizar." };
    }
    const resultante = patch.nombre != null ? formatearNombre(patch.nombre) : actual;
    exigirPermiso("hipodromos:fn_guardar_hipodromo", { hipodromo: actual });
    exigirPermiso("hipodromos:fn_guardar_hipodromo", { hipodromo: resultante });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!supabase) {
    cacheLocal = cacheLocal.map((h) =>
      String(h.id) === String(id)
        ? { ...h, nombre: patch.nombre != null ? formatearNombre(patch.nombre) : h.nombre, pais: patch.pais != null ? patch.pais.toUpperCase() : h.pais, estado: patch.estado != null ? normalizarEstado(patch.estado) : h.estado }
        : h
    );
    return { ok: true };
  }
  try {
    const datos: Record<string, string> = {};
    if (patch.nombre != null) datos.nombre = formatearNombre(patch.nombre);
    if (patch.pais != null) datos.pais = patch.pais.toUpperCase();
    if (patch.estado != null) datos.estado = normalizarEstado(patch.estado);
    const { error } = await supabase.from("hipodromos").update(datos).eq("id", id);
    if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nombre de un hipodromo por id, para compararlo contra la lista de hipodromos
 * asignados al operador (que son nombres, no ids).
 *
 * Primero busca en la cache local; si no esta, pregunta a la base. Se
 * selecciona solo el nombre: pedir la fila entera para leer una columna es
 * pedir de mas, y en una tabla con RLS pedir de mas es pedir de sobra.
 */
async function nombreDeHipodromo(id: string | number): Promise<string | null> {
  const enCache = cacheLocal.find((h) => String(h.id) === String(id));
  if (!supabase) return enCache ? enCache.nombre : null;
  // Se pregunta a la base PRIMERO y la caché se usa de respaldo. Al revés era
  // un agujero silencioso: si otro usuario renombraba el hipódromo y esta
  // pestaña no había recargado, el guard comparaba contra un nombre viejo y
  // daba el permiso sobre una fila que ya no era esa.
  try {
    const { data, error } = await supabase.from("hipodromos").select("nombre").eq("id", id).maybeSingle();
    if (!error && data) return String(data.nombre ?? "");
    return enCache ? enCache.nombre : null;
  } catch {
    return enCache ? enCache.nombre : null;
  }
}

/**
 * BAJA LÓGICA del hipódromo.
 *
 * NO borra la fila: marca `eliminado_en`. El DELETE físico reventaba por FK en
 * cuanto el hipódromo tenía una carrera, una tabla o un ticket — o sea, siempre.
 * Ahora la fila queda archivada: desaparece de los selectores y de la lista, pero
 * todo lo que ya se registró con ese nombre (carreras, marcas, tablas, tickets,
 * liquidaciones) sigue consultable. `reactivarHipodromo` la devuelve.
 */
export async function eliminarHipodromo(id: string | number): Promise<ResCrud> {
  try {
    // Borrar no necesita el nombre: el id identifica el registro. Pero la regla
    // compara contra la lista de hipódromos del operador, que guarda NOMBRES, así
    // que hay que resolver el nombre antes de decidir. Si el hipódromo no está
    // en la caché (se acaba de cargar, o hay otro navegador), se va al final con
    // una comprobación directa en la base: es más una consulta que dejar pasar
    // el borrado sin verificar.
    const actual = await nombreDeHipodromo(id);
    if (actual === null) {
      return { ok: false, error: "No se encontró el hipódromo a eliminar." };
    }
    exigirPermiso("hipodromos:btn_eliminar", { hipodromo: actual });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const baja = { estado: "Inactivo", eliminado_en: new Date().toISOString() };
  if (!supabase) {
    cacheLocal = cacheLocal.map((h) =>
      String(h.id) === String(id) ? { ...h, estado: "Inactivo", eliminado_en: baja.eliminado_en } : h
    );
    return { ok: true };
  }
  try {
    const { error } = await supabase.from("hipodromos").update(baja).eq("id", id);
    if (error) {
      // Sin la columna (falta aplicar sql/hipodromos.sql) no se cae a un DELETE:
      // se avisa y el operador no pierde datos por un script pendiente.
      if (esColumnaAusente(error.message)) {
        return { ok: false, error: "Aplique sql/hipodromos.sql: falta la columna eliminado_en." };
      }
      return { ok: false, error: error.message, code: error.code ?? undefined };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** `true` cuando el error es "la columna/tabla no existe" → falta aplicar SQL. */
function esColumnaAusente(msg: string): boolean {
  return /eliminado_en|does not exist|PGRST202|PGRST204|schema cache/i.test(msg);
}

/**
 * Reactiva un hipódromo archivado: limpia `eliminado_en` y lo deja 'Activo'.
 * Es la inversa de `eliminarHipodromo` y conserva el MISMO id, de modo que las
 * carreras, tablas y tickets que ya apuntan a esa fila siguen enlazados.
 */
export async function reactivarHipodromo(id: string | number): Promise<ResCrud> {
  try {
    const actual = await nombreDeHipodromo(id);
    if (actual === null) return { ok: false, error: "No se encontró el hipódromo a reactivar." };
    exigirPermiso("hipodromos:fn_guardar_hipodromo", { hipodromo: actual });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const alta = { estado: "Activo", eliminado_en: null, eliminado_por: null };
  if (!supabase) {
    cacheLocal = cacheLocal.map((h) => (String(h.id) === String(id) ? { ...h, ...alta } : h));
    return { ok: true, reactivado: true };
  }
  try {
    const { error } = await supabase.from("hipodromos").update(alta).eq("id", id);
    if (error) {
      if (esColumnaAusente(error.message)) {
        return { ok: false, error: "Aplique sql/hipodromos.sql: falta la columna eliminado_en." };
      }
      return { ok: false, error: error.message, code: error.code ?? undefined };
    }
    return { ok: true, reactivado: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * ACTIVA TODOS los hipódromos registrados que no estén archivados.
 *
 * Los que estaban en 'Inactivo' quedaban fuera de los selectores sin que nadie
 * supiera por qué. Los archivados NO se reactivan en bloque: eso es decisión del
 * operador, una fila por fila, en la sección "Archivados".
 */
export async function activarTodosHipodromos(): Promise<{ ok: boolean; error?: string; activados?: number }> {
  try {
    exigirCapacidad("hipodromos:fn_guardar_hipodromo");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!supabase) {
    let n = 0;
    cacheLocal = cacheLocal.map((h) => {
      if (estaBorrado(h)) return h;
      if (normalizarEstado(h.estado) === "Activo") return h;
      n++;
      return { ...h, estado: "Activo" };
    });
    return { ok: true, activados: n };
  }
  try {
    const { data, error } = await supabase
      .from("hipodromos")
      .update({ estado: "Activo" })
      .is("eliminado_en", null)
      .neq("estado", "Activo")
      .select("id");
    if (error) {
      if (esColumnaAusente(error.message)) {
        return { ok: false, error: "Aplique sql/hipodromos.sql: falta la columna eliminado_en." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, activados: (data ?? []).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}