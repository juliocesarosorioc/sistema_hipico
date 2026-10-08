/**
 * ============================================================================
 * ACCESOS — lectura y escritura de la matriz del maestro
 * ============================================================================
 *
 * Tablas del modelo (src/db/seguridad_maestro.sql):
 *   capacidad              → una fila por capacidad del registro maestro
 *   tipo_usuario           → los tipos de usuario (admin, operador, consulta,
 *                            jugador, y los que se creen nuevos)
 *   tipo_usuario_capacidad → la matriz: qué tipo tiene qué capacidad
 *   usuario_sistema        → quién usa el sistema y con qué tipo
 *   usuario_capacidad      → excepciones individuales por usuario
 *
 * PRINCIPIO: si la BD de seguridad no está aplicada, el sistema FUNCIONA pero
 * cae a `baseDeTipo(nombre)`, que es la base genérica de cada tipo. Nunca a
 * "todo permitido".
 */

import { supabase } from "@/lib/supabase";
import { exigirCapacidad, usuarioVigente } from "@/lib/seguridad/vigente";
import { CAPACIDADES } from "@/lib/seguridad/capacidades";
import { baseDeTipo, expandirConRequisitos, esUsuarioPrincipal, TIPOS_USUARIO_SISTEMA, USUARIO_PRINCIPAL } from "@/lib/seguridad/resolver";
import type { Decision, ExcepcionUsuario, ResGuardarAccesos, TipoUsuario } from "@/lib/seguridad/tipos";

/** Tipos del sistema, con su base genérica ya expandida. */
export function tiposPorDefecto(): TipoUsuario[] {
  return TIPOS_USUARIO_SISTEMA.map((t, i) => ({
    id: i + 1,
    nombre: t.nombre,
    descripcion: t.descripcion,
    activo: true,
    sistema: true,
    capacidades: [...expandirConRequisitos(baseDeTipo(t.nombre))],
  }));
}

const sonDecisiones = (v: unknown): v is Decision =>
  v === "permitido" || v === "denegado" || v === "heredado";

/**
 * Reduce el identificador con el que se entra a la clave con la que se da de
 * alta. El login acepta `josorioc` y también `josorioc@dominio`, pero
 * `usuario_sistema.id` se siembra con la parte local: si no se normaliza, al
 * recargar la página (donde solo se tiene el correo de la sesión) el usuario
 * deja de encontrar su tipo y se queda sin nada.
 */
export function claveDeUsuario(identificador: string | null | undefined): string {
  return String(identificador ?? "")
    .trim()
    .toLowerCase()
    .split("@")[0];
}

/** Todos los tipos de usuario con su matriz. */
export async function leerTiposUsuario(): Promise<TipoUsuario[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("tipo_usuario_capacidad")
        .select("tipo_usuario_id, decision, capacidad (clave)");
      const { data: tipos, error: e2 } = await supabase
        .from("tipo_usuario")
        .select("id, nombre, descripcion, activo")
        .order("id");
      if (!error && !e2 && Array.isArray(tipos) && tipos.length) {
        const porTipo = new Map<string, string[]>();
        for (const fila of data ?? []) {
          const clave = (fila.capacidad as { clave?: string } | null)?.clave;
          if (!clave) continue;
          if (fila.decision === "denegado") continue;
          const lista = porTipo.get(String(fila.tipo_usuario_id)) ?? [];
          lista.push(clave);
          porTipo.set(String(fila.tipo_usuario_id), lista);
        }
        return (tipos as TipoUsuario[]).map((t) => ({
          ...t,
          sistema: TIPOS_USUARIO_SISTEMA.some((s) => s.nombre === t.nombre),
          capacidades: porTipo.get(String(t.id)) ?? [],
        }));
      }
    } catch {
      /* cae a los defaults */
    }
  }
  return tiposPorDefecto();
}

/** El tipo de un identificador concreto, o null si no está dado de alta. */
export async function leerTipoDeUsuario(identificador: string): Promise<TipoUsuario | null> {
  if (!supabase) {
    const n = claveDeUsuario(identificador);
    const def = tiposPorDefecto();
    if (esUsuarioPrincipal(n)) return def.find((t) => t.nombre === "admin") ?? null;
    return null;
  }
  try {
    // La columna primaria es `id`, no `clave`: `clave` es de la tabla
    // `capacidad`. Con `clave` la consulta no encontraba a nadie y el usuario
    // perdía su tipo al recargar.
  const id = claveDeUsuario(identificador);
  const { data: alta } = await supabase
    .from("usuario_sistema")
    .select("tipo_usuario_id, activo")
    .eq("id", id)
    .maybeSingle();
  // Un alta dada de baja no accede a nada, aunque su tipo siga activo: es la
  // forma de cortar a una persona sin borrar su historial.
  if (alta && (alta as { activo?: unknown }).activo === false) return null;
  const tipoId = (alta as { tipo_usuario_id?: unknown } | null)?.tipo_usuario_id;
  if (tipoId == null) return null;

  const { data: tipo } = await supabase
    .from("tipo_usuario")
    .select("id, nombre, descripcion, activo")
    .eq("id", tipoId)
    .maybeSingle();
  if (!tipo) return null;
  // Tipo desactivado: se conserva su matriz para poder reactivarlo, pero no
  // reparte ni una capacidad. Sin esto, `actualizarTipoUsuario({activo:false})`
  // no tendría ningún efecto y el tipo seguiría dando acceso.
  if ((tipo as { activo?: unknown }).activo === false) return null;

    const { data: caps } = await supabase
      .from("tipo_usuario_capacidad")
      .select("decision, capacidad (clave)")
      .eq("tipo_usuario_id", tipoId);

    const capacidades = (caps ?? [])
      .filter((f) => f.decision !== "denegado")
      .map((f) => (f.capacidad as { clave?: string } | null)?.clave)
      .filter((k): k is string => Boolean(k));

    return { ...(tipo as TipoUsuario), capacidades };
  } catch {
    return null;
  }
}

/** Excepciones individuales de un usuario por encima de la base de su tipo. */
export async function permisosIndividuales(usuarioId: string): Promise<ExcepcionUsuario> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from("usuario_capacidad")
      .select("decision, capacidad (clave)")
      .eq("usuario_id", claveDeUsuario(usuarioId));
    if (error || !Array.isArray(data)) return {};
    const salida: ExcepcionUsuario = {};
    for (const f of data) {
      const clave = (f.capacidad as { clave?: string } | null)?.clave;
      if (clave && sonDecisiones(f.decision)) salida[clave] = f.decision;
    }
    return salida;
  } catch {
    return {};
  }
}

/**
 * Atributos ABAC de un usuario (los que son de la PERSONA, no del registro).
 *
 * Viene de `usuario_atributo`, que el admin carga desde el maestro. Acá se
 * traduce de filas a un objeto plano que `setAccesosVigentes` guarda en la
 * sesión: { usuario_hipodromos: ["LA TRINIDAD", ...] }.
 *
 * Es lo que permite "este operador solo trabaja estos hipódromos" sin que la
 * lista esté escrita en el código. Y como se carga desde la sesión y no desde
 * la llamada, la UI no puede ampliarla por su cuenta.
 *
 * Si la tabla no existe todavía (esquema sin aplicar) se devuelve {} y las
 * reglas `en_atributo` bloquean: es el comportamiento correcto, porque sin la
 * lista no se puede saber qué se permite.
 */
export async function atributosDeUsuario(usuarioId: string): Promise<Record<string, unknown>> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from("usuario_atributo")
      .select("valor, atributo (clave, tipo)")
      .eq("usuario_id", claveDeUsuario(usuarioId));
    if (error || !Array.isArray(data)) return {};
    const salida: Record<string, unknown> = {};
    for (const f of data) {
      const a = f.atributo as { clave?: string; tipo?: string } | null;
      const clave = a?.clave;
      if (!clave) continue;
      const valor = f.valor;
      // Los atributos tipo lista se guardan como array jsonb. Si viniera
      // escalado (una sola cadena con comas), se parte acá para que la regla
      // pueda compararlo sin enterarse de cómo lo escribió el admin.
      salida[clave] =
        a?.tipo === "lista" && typeof valor === "string"
          ? valor.split(",").map((s) => s.trim()).filter(Boolean)
          : valor;
    }
    return salida;
  } catch {
    return {};
  }
}

export type UsuarioAlta = {
  id: string;
  nombre?: string | null;
  /** Nombre del tipo de usuario ("admin", "operador"...), no el id numérico. */
  tipo: string;
  activo?: boolean;
  /** Solo el usuario principal lleva esa marca, y no se puede asignar a otro. */
  esPrincipal?: boolean;
  /** Cliente de `clientes` al que representa este usuario (puja en Remates). */
  clienteId?: string | null;
};

/**
 * Cliente vinculado a un usuario del sistema (`usuario_sistema.cliente_id`).
 *
 * Es la identidad del pujador en Remates: un usuario habilitado solo para
 * ver/PUJAR no elige comprador en la pizarra, puja siempre con ESTE cliente.
 * Devuelve null si el usuario no tiene cliente asociado o si la columna todavía
 * no existe en la base (migración `sql/remates_solo_pujar.sql` pendiente).
 */
export async function clienteDelUsuario(usuarioId?: string | null): Promise<string | null> {
  if (!supabase) return null;
  const id = claveDeUsuario(usuarioId || usuarioVigente());
  if (!id) return null;
  try {
    const { data, error } = await supabase.from("usuario_sistema").select("cliente_id").eq("id", id).maybeSingle();
    if (error || !data) return null;
    const cli = (data as { cliente_id?: string | null }).cliente_id;
    const limpio = String(cli ?? "").trim();
    return limpio || null;
  } catch {
    return null;
  }
}

/** Usuarios dados de alta en el sistema, agrupables por tipo. */
export async function leerUsuariosDelSistema(): Promise<UsuarioAlta[]> {
  if (supabase) {
    try {
      // `tipo` NO es una columna de `usuario_sistema`: la relación se hace por
      // `tipo_usuario_id`. Se trae el nombre del tipo desde la tabla `tipo_usuario`
      // y se proyecta a `tipo`, que es lo que espera la interfaz.
      const mapear = (filas: Array<Record<string, unknown>>) =>
        filas.map((u) => {
          const rel = u.tipo_usuario as { nombre?: string } | null;
          return {
            id: String(u.id ?? ""),
            nombre: (u.nombre as string | null) ?? null,
            tipo: rel?.nombre ?? "",
            activo: u.activo !== false,
            esPrincipal: u.es_principal === true,
            clienteId: (u.cliente_id as string | null) ?? null,
          };
        });

      type LecturaUsuarios = { data: Array<Record<string, unknown>> | null; error: { message?: string } | null };
      let lectura = (await supabase
        .from("usuario_sistema")
        .select("id, nombre, tipo_usuario_id, activo, es_principal, cliente_id, tipo_usuario (nombre)")
        .order("nombre")) as LecturaUsuarios;
      // Columna `cliente_id` sin migrar todavía (`sql/remates_solo_pujar.sql`):
      // se relee SIN el vínculo para que la lista de usuarios no se caiga.
      if (lectura.error && /cliente_id/i.test(lectura.error.message ?? "")) {
        lectura = (await supabase
          .from("usuario_sistema")
          .select("id, nombre, tipo_usuario_id, activo, es_principal, tipo_usuario (nombre)")
          .order("nombre")) as LecturaUsuarios;
      }
      if (!lectura.error && Array.isArray(lectura.data)) return mapear(lectura.data);
    } catch {
      /* cae al default */
    }
  }
  // Sin BD de seguridad, al menos se conoce al usuario principal.
  return [{ id: USUARIO_PRINCIPAL, nombre: "Usuario principal", tipo: "admin", activo: true, esPrincipal: true }];
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Crea (o reutiliza) la fila de `capacidad` y devuelve su id. */
async function idDeCapacidad(clave: string): Promise<number | null> {
  if (!supabase) return null;
  const { data: existente } = await supabase.from("capacidad").select("id").eq("clave", clave).maybeSingle();
  const id = (existente as { id?: number } | null)?.id;
  if (id != null) return id;
  const cap = CAPACIDADES.find((x) => x.clave === clave);
  if (!cap) return null;
  const { data: nuevo, error } = await supabase
    .from("capacidad")
    .insert({ clave: cap.clave, modulo: cap.modulo, tipo: cap.tipo, titulo: cap.titulo, riesgo: cap.riesgo, fuente: cap.fuente })
    .select("id")
    .maybeSingle();
  if (error) return null;
  return (nuevo as { id?: number } | null)?.id ?? null;
}

/** Guarda la matriz completa de un tipo de usuario. */
export async function guardarMatrizDeTipo(tipoId: number | string, claves: string[]): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("seguridad:fn_editar_matriz");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const validas = [...new Set(claves)].filter((k) => CAPACIDADES.some((c) => c.clave === k));
  if (validas.length !== claves.length) {
    const desconocidas = claves.filter((k) => !CAPACIDADES.some((c) => c.clave === k));
    return { ok: false, error: `Capacidades desconocidas: ${desconocidas.join(", ")}` };
  }
  try {
    const ids = await Promise.all(validas.map((k) => idDeCapacidad(k)));
    const { error: del } = await supabase.from("tipo_usuario_capacidad").delete().eq("tipo_usuario_id", tipoId);
    if (del) return { ok: false, error: del.message };
    const filas = ids
      .map((id, i) => (id == null ? null : { tipo_usuario_id: tipoId, capacidad_id: id, decision: "permitido" as Decision }))
      .filter((f): f is { tipo_usuario_id: number | string; capacidad_id: number; decision: Decision } => f !== null);
    if (filas.length) {
      const { error: ins } = await supabase.from("tipo_usuario_capacidad").insert(filas);
      if (ins) return { ok: false, error: ins.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Guarda las excepciones individuales de un usuario. */
export async function guardarExcepcionesDeUsuario(usuarioId: string, excepciones: ExcepcionUsuario): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("seguridad:fn_personalizar_usuario");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const entradas = Object.entries(excepciones).filter(([, d]) => d === "permitido" || d === "denegado");
  try {
    const ids = await Promise.all(entradas.map(([k]) => idDeCapacidad(k)));
    const { error: del } = await supabase.from("usuario_capacidad").delete().eq("usuario_id", usuarioId);
    if (del) return { ok: false, error: del.message };
    const filas = ids
      .map((id, i) => (id == null ? null : { usuario_id: usuarioId, capacidad_id: id, decision: entradas[i][1] as Decision }))
      .filter((f): f is { usuario_id: string; capacidad_id: number; decision: Decision } => f !== null);
    if (filas.length) {
      const { error: ins } = await supabase.from("usuario_capacidad").insert(filas);
      if (ins) return { ok: false, error: ins.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Crea un tipo de usuario nuevo con su base genérica. */
export async function crearTipoUsuario(nombre: string, descripcion: string): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("seguridad:fn_crear_tipo");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const limpio = nombre.trim().toLowerCase();
  if (!limpio) return { ok: false, error: "El tipo necesita un nombre." };
  try {
    const { data, error } = await supabase
      .from("tipo_usuario")
      .insert({ nombre: limpio, descripcion, activo: true })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    const id = (data as { id?: number } | null)?.id;
    if (id == null) return { ok: false, error: "No pude leer el id del tipo creado." };
    const r = await guardarMatrizDeTipo(id, baseDeTipo(limpio));
    return r.ok ? { ok: true } : { ok: false, error: `Tipo creado, pero la matriz no: ${r.error}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Activa o desactiva un tipo de usuario, y le corrige la descripción.
 *
 * Desactivar NO borra la matriz: la deja intacta para poder reactivarlo. Un
 * tipo inactivo no reparte capacidades (ver `leerTipoDeUsuario`).
 *
 * El nombre NO se edita a propósito: es la clave que seedea la matriz y la que
 * comparan `baseDeTipo` y las cookies. Renombrarlo en caliente dejaba tipos
 * huérfanos; para cambiarlo hay que crear otro y migrar.
 */
export async function actualizarTipoUsuario(
  tipoId: number | string,
  patch: { activo?: boolean; descripcion?: string }
): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("seguridad:fn_editar_tipo");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const datos: Record<string, unknown> = {};
  if (typeof patch.activo === "boolean") datos.activo = patch.activo;
  if (typeof patch.descripcion === "string") datos.descripcion = patch.descripcion.trim();
  if (!Object.keys(datos).length) return { ok: false, error: "No hay nada que guardar." };
  const { error } = await supabase.from("tipo_usuario").update(datos).eq("id", tipoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Da de alta o actualiza un usuario del sistema y su tipo. */
export async function guardarUsuarioSistema(u: UsuarioAlta): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("seguridad:fn_asignar_tipo");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const clave = claveDeUsuario(u.id);
  if (!clave) return { ok: false, error: "El usuario necesita su identificador." };
  if (u.esPrincipal && !esUsuarioPrincipal(clave)) {
    return { ok: false, error: "Solo el usuario principal puede marcarse como principal." };
  }
  try {
    const { data: tipo, error: e1 } = await supabase
      .from("tipo_usuario")
      .select("id")
      .eq("nombre", u.tipo.trim().toLowerCase())
      .maybeSingle();
    if (e1) return { ok: false, error: e1.message };
    const tipoId = (tipo as { id?: number } | null)?.id;
    if (tipoId == null) return { ok: false, error: `El tipo "${u.tipo}" no existe.` };

    let { error } = await supabase.from("usuario_sistema").upsert(
      {
        id: clave,
        nombre: u.nombre ?? null,
        tipo_usuario_id: tipoId,
        activo: u.activo !== false,
        es_principal: esUsuarioPrincipal(clave),
        // Vínculo con el cliente que representa (puja en Remates). `null` deja
        // el vínculo limpio.
        cliente_id: u.clienteId ? String(u.clienteId) : null,
      },
      { onConflict: "id" }
    );
    // Columna `cliente_id` todavía sin migrar (`sql/remates_solo_pujar.sql`):
    // se reintenta SIN el vínculo para que el alta del usuario no se rompa.
    if (error && /cliente_id/i.test(error.message ?? "")) {
      const r2 = await supabase.from("usuario_sistema").upsert(
        {
          id: clave,
          nombre: u.nombre ?? null,
          tipo_usuario_id: tipoId,
          activo: u.activo !== false,
          es_principal: esUsuarioPrincipal(clave),
        },
        { onConflict: "id" }
      );
      error = r2.error;
    }
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
