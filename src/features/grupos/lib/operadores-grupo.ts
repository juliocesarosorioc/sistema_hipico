/**
 * ============================================================================
 * OPERADORES DE GRUPO — Acceso celular y gestión por grupo de venta
 * ============================================================================
 *
 * Permite a los administradores asignar uno o varios operadores a cada grupo
 * dentro del modal de grupos, con:
 *   - Nombre de usuario para acceso desde el celular
 *   - Contraseña de acceso
 *   - Nombre / alias del operador
 *   - Hipódromos autorizados (atributo ABAC usuario_hipodromos)
 *   - Estado activo/inactivo
 */
import { supabase } from "@/core/supabase";
import { claveDeUsuario } from "@/features/seguridad/lib/accesos";
import { guardarHipodromosDeOperador, CLAVE_HIPODROMOS } from "@/features/operadores/lib/operadores";
import { basePathActual } from "@/features/auth/lib/sesion";

export type OperadorGrupo = {
  id: string; // nombre de usuario para acceso celular
  nombre: string;
  grupoId: string;
  grupoNombre?: string;
  clave?: string;
  telefono?: string;
  codigoPais?: string;
  activo: boolean;
  hipodromos: string[];
  creadoEn?: string;
};

export type OperadorCache = {
  usuario: string;
  clave: string;
  grupoId: string;
  grupoNombre: string;
  nombre?: string;
  telefono?: string;
};

const CLAVE_STORAGE_CLAVES = "hipico_operadores_claves_cache";
const CLAVE_STORAGE_OPERADORES = "hipico_operadores_perfiles_cache";

/** Almacena claves de operadores en cache local como respaldo seguro */
function guardarClaveEnCacheLocal(usuarioId: string, clave: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    const mapa = raw ? JSON.parse(raw) : {};
    mapa[usuarioId.toLowerCase()] = clave;
    window.localStorage.setItem(CLAVE_STORAGE_CLAVES, JSON.stringify(mapa));
  } catch {
    // ignore
  }
}

export function obtenerClaveCacheLocal(usuarioId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    if (!raw) return null;
    const mapa = JSON.parse(raw);
    return mapa[usuarioId.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

/** Guarda el perfil completo del operador en caché local */
export function guardarOperadorEnCacheLocal(op: OperadorCache): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    const mapa = raw ? JSON.parse(raw) : {};
    const key = op.usuario.toLowerCase().trim();
    mapa[key] = op;
    if (op.telefono) {
      const dig = op.telefono.replace(/\D/g, "");
      if (dig) mapa[dig] = op;
    }
    window.localStorage.setItem(CLAVE_STORAGE_OPERADORES, JSON.stringify(mapa));
    guardarClaveEnCacheLocal(key, op.clave);
    if (op.telefono) {
      const dig = op.telefono.replace(/\D/g, "");
      if (dig) guardarClaveEnCacheLocal(dig, op.clave);
    }
  } catch {
    // ignore
  }
}

/** Obtiene el perfil completo del operador desde la caché local */
export function obtenerOperadorCacheLocal(usuarioId: string): OperadorCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    if (!raw) return null;
    const mapa = JSON.parse(raw);
    const key = usuarioId.toLowerCase().trim();
    return mapa[key] ?? null;
  } catch {
    return null;
  }
}

/** Elimina un operador de la caché local para que no retenga grupos viejos */
export function eliminarOperadorDeCacheLocal(usuarioId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = usuarioId.toLowerCase().trim();
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    if (raw) {
      const mapa = JSON.parse(raw);
      delete mapa[key];
      window.localStorage.setItem(CLAVE_STORAGE_OPERADORES, JSON.stringify(mapa));
    }
    const rawClaves = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    if (rawClaves) {
      const mapaClaves = JSON.parse(rawClaves);
      delete mapaClaves[key];
      window.localStorage.setItem(CLAVE_STORAGE_CLAVES, JSON.stringify(mapaClaves));
    }
  } catch {
    // ignore
  }
}

/** Obtiene el id numérico del tipo 'operador' en la tabla tipo_usuario */
async function obtenerIdTipoOperador(): Promise<number> {
  if (!supabase) return 2;
  try {
    const { data } = await supabase
      .from("tipo_usuario")
      .select("id")
      .ilike("nombre", "operador")
      .maybeSingle();
    return (data as { id?: number } | null)?.id ?? 2;
  } catch {
    return 2;
  }
}

/** Lista los hipódromos asignados a cada usuario */
async function obtenerHipodromosUsuarios(ids: string[]): Promise<Record<string, string[]>> {
  if (!supabase || ids.length === 0) return {};
  try {
    const { data: atrs } = await supabase
      .from("atributo")
      .select("id")
      .eq("clave", CLAVE_HIPODROMOS)
      .maybeSingle();
    const idAtr = (atrs as { id?: number } | null)?.id;
    if (!idAtr) return {};

    const { data, error } = await supabase
      .from("usuario_atributo")
      .select("usuario_id, valor")
      .eq("atributo_id", idAtr)
      .in("usuario_id", ids.map((i) => claveDeUsuario(i)));

    if (error || !Array.isArray(data)) return {};
    const mapa: Record<string, string[]> = {};
    for (const fila of data as Array<{ usuario_id?: string; valor?: unknown }>) {
      const uid = String(fila.usuario_id ?? "").toLowerCase();
      const val = fila.valor;
      if (Array.isArray(val)) {
        mapa[uid] = val.map((x) => String(x)).filter(Boolean);
      } else if (typeof val === "string") {
        mapa[uid] = val.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return mapa;
  } catch {
    return {};
  }
}

/**
 * Lista todos los operadores asignados a un grupo de venta específico.
 */
export async function listarOperadoresDeGrupo(
  grupoId: string | number,
  grupoNombre?: string
): Promise<OperadorGrupo[]> {
  if (!supabase) return [];
  const gid = String(grupoId);

  try {
    // 1. Intentar leer incluyendo clave_acceso, telefono y codigo_pais
    let data: Array<Record<string, unknown>> | null = null;
    try {
      const res = await supabase
        .from("usuario_sistema")
        .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, telefono, codigo_pais, tipo_usuario_id, tipo_usuario(nombre)")
        .eq("grupo_id", gid);
      if (!res.error && Array.isArray(res.data)) {
        data = res.data;
      }
    } catch {
      data = null;
    }

    // 2. Si falló por columnas nuevas, reintentar con columnas base
    if (!data) {
      try {
        const resClave = await supabase
          .from("usuario_sistema")
          .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, tipo_usuario_id, tipo_usuario(nombre)")
          .eq("grupo_id", gid);
        if (!resClave.error && Array.isArray(resClave.data)) {
          data = resClave.data;
        }
      } catch {
        data = null;
      }
    }

    // 3. Fallback absoluto a columnas estándar
    if (!data) {
      const res2 = await supabase
        .from("usuario_sistema")
        .select("id, nombre, activo, grupo_id, creado_en, tipo_usuario_id, tipo_usuario(nombre)")
        .eq("grupo_id", gid);
      if (res2.error || !Array.isArray(res2.data)) {
        return [];
      }
      data = res2.data;
    }

    const ids = data.map((u) => String(u.id ?? ""));
    const hiposMap = await obtenerHipodromosUsuarios(ids);

    return data.map((u) => {
      const id = String(u.id ?? "");
      const claveRemota = u.clave_acceso ? String(u.clave_acceso) : null;
      const opCached = obtenerOperadorCacheLocal(id);
      const clave = claveRemota || opCached?.clave || obtenerClaveCacheLocal(id) || "";

      if (clave) {
        guardarOperadorEnCacheLocal({
          usuario: id,
          clave,
          grupoId: gid,
          grupoNombre: grupoNombre || opCached?.grupoNombre || "Grupo Asignado",
          nombre: String(u.nombre ?? id),
          telefono: u.telefono ? String(u.telefono) : undefined,
        });
      }

      return {
        id,
        nombre: String(u.nombre ?? id),
        grupoId: String(u.grupo_id ?? gid),
        grupoNombre: grupoNombre || opCached?.grupoNombre,
        clave,
        telefono: u.telefono ? String(u.telefono) : undefined,
        codigoPais: u.codigo_pais ? String(u.codigo_pais) : undefined,
        activo: u.activo !== false,
        hipodromos: hiposMap[id.toLowerCase()] ?? [],
        creadoEn: u.creado_en ? String(u.creado_en) : undefined,
      };
    });
  } catch (e) {
    console.error("Error al listar operadores de grupo:", e);
    return [];
  }
}

/**
 * Da de alta o actualiza un operador asignado al grupo.
 */
export async function guardarOperadorDeGrupo(params: {
  grupoId: string | number;
  grupoNombre?: string;
  usuario: string;
  nombre?: string;
  clave?: string;
  telefono?: string;
  codigoPais?: string;
  activo?: boolean;
  hipodromos?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };

  const idLimpio = claveDeUsuario(params.usuario);
  if (!idLimpio) return { ok: false, error: "El operador necesita un nombre de usuario de acceso." };

  const grupoIdStr = String(params.grupoId);
  const tipoId = await obtenerIdTipoOperador();
  const nombreLimpio = (params.nombre || idLimpio).trim();
  const claveLimpia = (params.clave || "").trim();
  const telefonoLimpio = (params.telefono || "").trim();
  const codPaisLimpio = (params.codigoPais || "+58").trim();

  // 0. Intentar guardar mediante RPC con bypass total de RLS
  try {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_guardar_operador", {
      p_usuario: idLimpio,
      p_nombre: nombreLimpio,
      p_clave: claveLimpia,
      p_grupo_id: grupoIdStr,
      p_telefono: telefonoLimpio || null,
      p_codigo_pais: codPaisLimpio,
      p_activo: params.activo !== false,
    });
    if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
      if (claveLimpia) {
        guardarOperadorEnCacheLocal({
          usuario: idLimpio,
          clave: claveLimpia,
          grupoId: grupoIdStr,
          grupoNombre: params.grupoNombre || ((rpcRes as Record<string, unknown>).grupoNombre as string) || "Grupo Asignado",
          nombre: nombreLimpio,
          telefono: telefonoLimpio,
        });
      }
      if (params.hipodromos !== undefined) {
        await guardarHipodromosDeOperador(idLimpio, params.hipodromos);
      }
      return { ok: true };
    }
  } catch {
    /* fallback al guardado directo */
  }

  try {
    // 1. Guardar en usuario_sistema (intentar con clave_acceso, telefono, codigo_pais)
    let errUpsert: { message?: string } | null = null;
    try {
      const payloadCompleto: Record<string, unknown> = {
        id: idLimpio,
        nombre: nombreLimpio,
        tipo_usuario_id: tipoId,
        grupo_id: grupoIdStr,
        activo: params.activo !== false,
        es_principal: false,
      };
      if (claveLimpia) payloadCompleto.clave_acceso = claveLimpia;
      if (telefonoLimpio) payloadCompleto.telefono = telefonoLimpio;
      if (codPaisLimpio) payloadCompleto.codigo_pais = codPaisLimpio;

      const res = await supabase
        .from("usuario_sistema")
        .upsert(payloadCompleto, { onConflict: "id" });
      errUpsert = res.error;
    } catch (e) {
      errUpsert = { message: String(e) };
    }

    // 2. Si dio error por columnas inexistentes, reintentar quitando telefono y codigo_pais
    if (errUpsert && /telefono|codigo_pais|column|does not exist/i.test(errUpsert.message ?? "")) {
      try {
        const payloadConClave: Record<string, unknown> = {
          id: idLimpio,
          nombre: nombreLimpio,
          tipo_usuario_id: tipoId,
          grupo_id: grupoIdStr,
          activo: params.activo !== false,
          es_principal: false,
        };
        if (claveLimpia) payloadConClave.clave_acceso = claveLimpia;

        const resConClave = await supabase
          .from("usuario_sistema")
          .upsert(payloadConClave, { onConflict: "id" });
        errUpsert = resConClave.error;
      } catch (e) {
        errUpsert = { message: String(e) };
      }
    }

    // 3. Si aún da error por clave_acceso, reintentar solo columnas base
    if (errUpsert && /clave_acceso|column|does not exist/i.test(errUpsert.message ?? "")) {
      const resSinClave = await supabase
        .from("usuario_sistema")
        .upsert(
          {
            id: idLimpio,
            nombre: nombreLimpio,
            tipo_usuario_id: tipoId,
            grupo_id: grupoIdStr,
            activo: params.activo !== false,
            es_principal: false,
          },
          { onConflict: "id" }
        );
      errUpsert = resSinClave.error;
    }

    if (errUpsert) {
      return { ok: false, error: `No se pudo registrar el operador: ${errUpsert.message}` };
    }

    // 4. Guardar en cache local el perfil completo para acceso y consulta inmediata (por id y por teléfono)
    if (claveLimpia) {
      guardarOperadorEnCacheLocal({
        usuario: idLimpio,
        clave: claveLimpia,
        grupoId: grupoIdStr,
        grupoNombre: params.grupoNombre || "Grupo Asignado",
        nombre: nombreLimpio,
        telefono: telefonoLimpio,
      });
    }

    // 5. Guardar los hipódromos asignados si se especificaron
    if (params.hipodromos !== undefined) {
      await guardarHipodromosDeOperador(idLimpio, params.hipodromos);
    }

    // 6. Intentar crear o actualizar en Supabase Auth mediante la edge function si existe
    if (claveLimpia) {
      try {
        void supabase.functions.invoke("crear-grupo", {
          body: {
            admin: null,
            operadores: [
              {
                usuario: idLimpio,
                nombre: nombreLimpio,
                tipo: "operador",
                clave: claveLimpia,
              },
            ],
            grupo: { id: grupoIdStr },
          },
        });
      } catch {
        /* best-effort */
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Desvincula o elimina un operador de este grupo.
 */
export async function desvincularOperadorDeGrupo(
  usuarioId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  const idLimpio = claveDeUsuario(usuarioId);

  // 1. Limpiar de caché local inmediatamente
  eliminarOperadorDeCacheLocal(idLimpio);

  try {
    // 2. Intentar eliminar por RPC con privilegios
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_eliminar_operador", {
        p_usuario: idLimpio,
      });
      if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
        return { ok: true };
      }
    } catch {
      /* fallback */
    }

    // 3. Fallback directo a la base de datos (eliminar registro para que no retenga el grupo)
    const { error: delErr } = await supabase.from("usuario_sistema").delete().eq("id", idLimpio);
    if (!delErr) return { ok: true };

    // 4. Si delete está bloqueado por FK, desvincular grupo_id y desactivar
    const { error } = await supabase
      .from("usuario_sistema")
      .update({ grupo_id: null, activo: false })
      .eq("id", idLimpio);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Alterna el estado activo/inactivo de un operador de grupo.
 */
export async function alternarEstadoOperador(
  usuarioId: string,
  activo: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  const idLimpio = claveDeUsuario(usuarioId);

  try {
    const { error } = await supabase
      .from("usuario_sistema")
      .update({ activo })
      .eq("id", idLimpio);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resuelve la URL canónica de login para compartir con el operador.
 */
export function urlLoginOperador(): string {
  if (typeof window === "undefined") return "https://app.sistemahipico.com/login/";
  const base = basePathActual();
  return `${window.location.origin}${base}/login/`;
}

/**
 * Genera un texto formateado para compartir las credenciales del operador por WhatsApp.
 */
export function generarMensajeWhatsappOperador(opts: {
  grupoNombre: string;
  usuario: string;
  clave: string;
  nombre?: string;
  telefono?: string;
  urlLogin?: string;
}): string {
  const url = opts.urlLogin || urlLoginOperador();
  const nombreTxt = opts.nombre ? `\n👤 *Operador:* ${opts.nombre}` : "";
  const telTxt = opts.telefono ? `\n📞 *Teléfono:* ${opts.telefono}` : "";

  return (
    `🏇 *ACCESO DE OPERADOR — TAQUILLA MÓVIL*\n` +
    `🏢 *Grupo:* ${opts.grupoNombre.toUpperCase()}${nombreTxt}${telTxt}\n` +
    `\n` +
    `📱 *Usuario / Teléfono:* \`${opts.usuario}\`\n` +
    `🔑 *Contraseña:* \`${opts.clave || "(asignada)"}\`\n` +
    `\n` +
    `🌐 *Enlace de Ingreso:* ${url}\n` +
    `\n` +
    `_Ingresa con tu usuario o celular y esta contraseña para registrar jugadas y consultar reportes._`
  );
}
