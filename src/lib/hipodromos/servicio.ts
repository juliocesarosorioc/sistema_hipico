/**
 * Servicio CRUD de Hipódromos contra la tabla compartida `hipodromos`
 * (mismo backend Supabase que el legacy — sin scripts de migración de datos).
 * Sin credenciales → respaldo en memoria para que la UI siga operativa.
 */
import { supabase } from "@/lib/supabase";
import { formatearNombre, type Hipodromo, type ResCrud, type ResListar } from "@/lib/hipodromos/tipos";

/** Catálogo de respaldo (sin conexión), paridad con el listado de la taquilla. */
const RESERVA: Array<Pick<Hipodromo, "nombre" | "pais" | "estado">> = [
  { nombre: "La Rinconada", pais: "VE", estado: "Activo" },
  { nombre: "Valencia", pais: "VE", estado: "Activo" },
  { nombre: "Santa Rita", pais: "VE", estado: "Activo" },
  { nombre: "Pomona", pais: "VE", estado: "Activo" },
  { nombre: "Gulfstream", pais: "USA", estado: "Activo" },
  { nombre: "Aqueduct", pais: "USA", estado: "Activo" },
  { nombre: "Belmont", pais: "USA", estado: "Activo" },
  { nombre: "Keeneland", pais: "USA", estado: "Activo" },
  { nombre: "Santa Anita", pais: "USA", estado: "Activo" },
  { nombre: "Del Mar", pais: "USA", estado: "Activo" },
  { nombre: "Woodbine", pais: "OTRO", estado: "Inactivo" },
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
  }));
  sembrada = true;
  return cacheLocal;
}

const normalizar = (r: Record<string, unknown>): Hipodromo => ({
  id: String(r.id ?? ""),
  nombre: String(r.nombre ?? ""),
  pais: String(r.pais ?? "OTRO").toUpperCase(),
  estado: String(r.estado ?? "Activo"),
  fecha_creacion: r.fecha_creacion ? String(r.fecha_creacion) : null,
});

/** SELECT * de hipódromos, ordenados alfabéticamente. */
export async function listarHipodromos(): Promise<ResListar> {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("hipodromos").select("*").order("nombre", { ascending: true });
      if (!error && Array.isArray(data)) {
        cacheLocal = (data as unknown[]).map((r) => normalizar(r as Record<string, unknown>));
        sembrada = true;
        return { ok: true, data: cacheLocal };
      }
      if (error) return { ok: true, data: sembrarReserva(), local: true };
    } catch {
      /* sin conexión → respaldo */
    }
  }
  return { ok: true, data: sembrarReserva(), local: true };
}

/** INSERT { nombre, pais } (mismo shape del legacy). */
export async function crearHipodromo(datos: { nombre: string; pais: string }): Promise<ResCrud> {
  const nombre = formatearNombre(datos.nombre);
  if (!supabase) {
    const id = `local-${Date.now().toString(36)}`;
    cacheLocal = [...cacheLocal, { id, nombre, pais: datos.pais.toUpperCase(), estado: "Activo", fecha_creacion: null }].sort((a, b) =>
      a.nombre.localeCompare(b.nombre)
    );
    return { ok: true };
  }
  try {
    const { error } = await supabase.from("hipodromos").insert([{ nombre, pais: datos.pais.toUpperCase() }]);
    if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** UPDATE { nombre, pais, estado } por id. */
export async function actualizarHipodromo(id: string | number, patch: Partial<Pick<Hipodromo, "nombre" | "pais" | "estado">>): Promise<ResCrud> {
  if (!supabase) {
    cacheLocal = cacheLocal.map((h) =>
      String(h.id) === String(id)
        ? { ...h, nombre: patch.nombre != null ? formatearNombre(patch.nombre) : h.nombre, pais: patch.pais != null ? patch.pais.toUpperCase() : h.pais, estado: patch.estado ?? h.estado }
        : h
    );
    return { ok: true };
  }
  try {
    const datos: Record<string, string> = {};
    if (patch.nombre != null) datos.nombre = formatearNombre(patch.nombre);
    if (patch.pais != null) datos.pais = patch.pais.toUpperCase();
    if (patch.estado != null) datos.estado = patch.estado;
    const { error } = await supabase.from("hipodromos").update(datos).eq("id", id);
    if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** DELETE por id (el legacy advierte si hay tablas/tickets asociados → FK). */
export async function eliminarHipodromo(id: string | number): Promise<ResCrud> {
  if (!supabase) {
    cacheLocal = cacheLocal.filter((h) => String(h.id) !== String(id));
    return { ok: true };
  }
  try {
    const { error } = await supabase.from("hipodromos").delete().eq("id", id);
    if (error) return { ok: false, error: error.message, code: error.code ?? undefined };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}